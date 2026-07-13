/**
 * The single source of truth for "can we spend a Gemini free-tier request
 * right now?" — wraps the pure math in src/domain/quota.ts with the two DB
 * reads it needs: today's usage_events (split into interactive/background by
 * presence of a userId) and the `quota_state` singleton (whether a DAILY 429
 * was recently observed).
 *
 * Callers:
 *  - src/ai/client.ts's GeminiDriver calls `markExhausted` the moment it
 *    classifies a 429 as daily-exhaustion (see src/domain/rate-limit.ts).
 *  - Background sweepers (src/jobs/sweep-*.ts) and the analysis segment loop
 *    (src/jobs/analyze-book.ts) call `canSpend("background")` before firing
 *    a fresh LLM call.
 *  - Interactive callers (src/services/chat.ts, src/services/overlays.ts)
 *    call `canSpend("interactive")` before firing.
 *  - src/services/queue.ts's admin panel calls `getQuota` to show the real
 *    split.
 *
 * Thin — no route/auth logic (see CLAUDE.md "Route handlers are thin").
 */
import { eq, gte } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { quotaState, usageEvents } from "@/db/schema";
import {
  canSpend as canSpendPure,
  computeQuotaState,
  splitUsage,
  startOfUtcDay,
  type QuotaKind,
  type QuotaState,
} from "@/domain/quota";

export type { QuotaKind, QuotaState };

// Fixed row id for the quota_state singleton — there is exactly one quota
// clock for the whole app (not per-book/per-user).
const SINGLETON_ID = 1;

/**
 * Today's full quota snapshot: total/interactive/background usage, how much
 * of the background slice remains, and whether a recent daily 429 has the
 * whole system paused. Two small, fixed-cost queries regardless of traffic
 * volume.
 */
export async function getQuota(now: Date = new Date()): Promise<QuotaState> {
  await dbReady;

  const todayStart = startOfUtcDay(now);
  const [events, [stateRow]] = await Promise.all([
    db
      .select({ userId: usageEvents.userId })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, todayStart)),
    db
      .select({ exhaustedUntil: quotaState.exhaustedUntil })
      .from(quotaState)
      .where(eq(quotaState.id, SINGLETON_ID))
      .limit(1),
  ]);

  const { interactiveUsed, backgroundUsed } = splitUsage(events);

  return computeQuotaState({
    interactiveUsed,
    backgroundUsed,
    exhaustedUntil: stateRow?.exhaustedUntil ?? null,
  });
}

/**
 * True when a call of `kind` is safe to fire right now. Background calls
 * additionally exhaust their own reserved slice of the daily budget;
 * interactive calls are only blocked by a global (whole-system) exhaustion.
 */
export async function canSpend(
  kind: QuotaKind,
  now: Date = new Date(),
): Promise<boolean> {
  const quota = await getQuota(now);
  return canSpendPure(kind, quota, now);
}

/**
 * Records a DAILY-exhaustion 429: every `canSpend()` check fails closed
 * until `untilMs`. Only ever extends the exhaustion window — a later,
 * shorter estimate never un-pauses a longer one already recorded (e.g. two
 * calls racing to report the same storm).
 */
export async function markExhausted(untilMs: number): Promise<void> {
  await dbReady;

  const until = new Date(untilMs);
  const [existing] = await db
    .select({ exhaustedUntil: quotaState.exhaustedUntil })
    .from(quotaState)
    .where(eq(quotaState.id, SINGLETON_ID))
    .limit(1);

  const next =
    existing?.exhaustedUntil &&
    existing.exhaustedUntil.getTime() > until.getTime()
      ? existing.exhaustedUntil
      : until;

  await db
    .insert(quotaState)
    .values({ id: SINGLETON_ID, exhaustedUntil: next })
    .onConflictDoUpdate({
      target: quotaState.id,
      set: { exhaustedUntil: next, updatedAt: new Date() },
    });

  console.warn(
    `[quota] marked exhausted until ${next.toISOString()} — every canSpend() check fails closed until then`,
  );
}
