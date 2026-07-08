import { ApiError } from "@/lib/errors";

/**
 * In-memory fixed/sliding-window rate limiter.
 *
 * LIMITATION: this state lives in process memory, so it's per-instance —
 * on a multi-instance deployment (e.g. several Vercel Hobby lambdas warm at
 * once) the effective limit is `max * instanceCount`, not a hard global
 * cap. That's an acceptable trade-off at this scale and avoids standing up
 * a new vendor (e.g. Upstash Redis) purely for rate limiting — see the
 * ZERO-COST CONSTRAINT in CLAUDE.md. The *expensive* limits (LLM calls that
 * burn the Gemini free-tier daily quota) are additionally enforced by the
 * DB-backed daily counters in src/services/entitlements.ts, which ARE
 * correct across instances since they read from Postgres.
 */

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

// Periodically forget old buckets so this Map doesn't grow unbounded across
// a long-lived process. Cheap: just drop anything whose window has closed.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > SWEEP_INTERVAL_MS) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitOptions {
  windowSeconds: number;
  max: number;
}

/**
 * Fixed-window rate limit keyed by an arbitrary string (e.g.
 * `user:${userId}:chat` or `ip:${ip}:v1`). Throws a 429 ApiError once `max`
 * calls have been made within the current `windowSeconds` window.
 */
export function rateLimit(key: string, { windowSeconds, max }: RateLimitOptions): void {
  const now = Date.now();
  sweep(now);

  const windowMs = windowSeconds * 1000;
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return;
  }

  if (existing.count >= max) {
    const retryAfterSeconds = Math.ceil((existing.windowStart + windowMs - now) / 1000);
    throw new ApiError(
      429,
      "rate_limited",
      `Too many requests. Try again in ${retryAfterSeconds}s.`,
    );
  }

  existing.count += 1;
}

/** Test-only: clears all rate limit state. */
export function __resetRateLimitsForTests(): void {
  buckets.clear();
}
