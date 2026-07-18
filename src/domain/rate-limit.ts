/**
 * Pure classification of a Gemini 429/RESOURCE_EXHAUSTED error into
 * "transient" (per-minute RPM cap — safe to retry with backoff) vs "daily"
 * (the whole day's request budget is gone — retrying just burns time on a
 * call that will 429 again). No I/O, no clock reads beyond what's passed
 * in — src/ai/client.ts owns extracting `message`/`retryAfterMs` from the
 * actual SDK error and acting on the result (retry vs markExhausted).
 *
 * BACKGROUND: the incident that motivated this — an over-aggressive
 * backfill retried through a DAILY 429 as if it were transient, burning the
 * rest of the day's quota on calls that could never succeed and 429ing
 * everything else (including chat) along with it.
 */

type RateLimitKind = "none" | "transient" | "daily";

export interface RateLimitInfo {
  kind: RateLimitKind;
  retryAfterMs: number | null;
}

/** A retry-after this long can only mean a daily (not per-minute) reset —
 * Gemini's per-minute RPM backoff never asks you to wait this long. */
const DAILY_RETRY_THRESHOLD_MS = 120_000;

/** Substrings Gemini's 429 error message uses to name the exhausted metric
 * when it's the daily (not per-minute) quota. Matched case-insensitively. */
const DAILY_METRIC_HINTS = [
  /per\s*day/i,
  /daily/i,
  /PerDayPerProjectPerModel/i,
  /generate_requests_per_model_per_day/i,
  // The July 2026 incident's exact metric name — a daily cap despite the
  // error carrying a short (~46s) retryDelay hint that made it look
  // transient. The free-tier request pool IS the daily budget.
  /free_tier_requests/i,
];

function isRateLimitMessage(message: string): boolean {
  return /RESOURCE_EXHAUSTED|429/i.test(message);
}

/**
 * Extracts a "retry in Ns" (or "retryDelay": "Ns") hint from a Gemini error
 * message, in milliseconds. Returns null if no such hint is present.
 */
export function parseRetryAfterMs(message: string): number | null {
  const retryIn = message.match(/retry\s*in\s*(\d+(?:\.\d+)?)\s*s/i);
  if (retryIn) return Math.round(parseFloat(retryIn[1]) * 1000);

  const retryDelay = message.match(
    /retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)\s*s/i,
  );
  if (retryDelay) return Math.round(parseFloat(retryDelay[1]) * 1000);

  return null;
}

/**
 * Classifies a rate-limit error message as daily-exhaustion vs transient.
 * `retryAfterMs` should already be parsed out of the message (see
 * `parseRetryAfterMs`) — passed in separately so callers with a structured
 * retry-after (e.g. an SDK-provided field) don't need to round-trip through
 * message parsing.
 *
 * kind === "none" when the message doesn't look like a rate limit at all
 * (callers should treat this as "not a 429" and handle it as any other
 * error).
 */
export function classifyRateLimitError(opts: {
  message: string;
  retryAfterMs?: number | null;
}): RateLimitInfo {
  const { message } = opts;
  if (!isRateLimitMessage(message)) {
    return { kind: "none", retryAfterMs: null };
  }

  const retryAfterMs = opts.retryAfterMs ?? parseRetryAfterMs(message);
  const namesDailyMetric = DAILY_METRIC_HINTS.some((re) => re.test(message));
  const longRetry =
    retryAfterMs !== null && retryAfterMs > DAILY_RETRY_THRESHOLD_MS;

  if (namesDailyMetric || longRetry) {
    return { kind: "daily", retryAfterMs };
  }
  return { kind: "transient", retryAfterMs };
}
