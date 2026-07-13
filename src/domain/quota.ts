/**
 * Pure quota math for the Gemini free-tier daily budget (see CLAUDE.md ZERO-
 * COST CONSTRAINT + the "quota-aware pipeline" architecture note in
 * src/services/quota.ts, which is the DB-backed service that wraps these
 * helpers). Nothing here touches the database or the clock beyond what's
 * passed in, so it's exhaustively unit-testable without mocks.
 *
 * THE SPLIT: a real 429 storm (Sat July 2026) proved the free-tier cap for
 * the `flash-lite-latest` alias is 500 requests/DAY, shared by every caller.
 * The founder's fix: reserve a slice for INTERACTIVE traffic (chat + on-read
 * illustrations — the reader is staring at the screen right now) and let
 * BACKGROUND sweepers (analysis/overlay/cover/fun-facts backfills) use the
 * rest. usage_events rows already distinguish the two for free: interactive
 * calls carry a `userId` (see CompleteJsonOptions.userId in src/ai/client.ts),
 * background calls don't.
 */

/** Real Google AI Studio free-tier daily cap for the model alias in use. */
export const GEMINI_FREE_TIER_RPD = 500;

/** Reserved for chat + on-read illustrations, so a background backlog can
 * never starve a reader who's actively using the app. */
export const INTERACTIVE_RESERVE = 50;

/** What's left for the always-on background sweepers. */
export const BACKGROUND_BUDGET = GEMINI_FREE_TIER_RPD - INTERACTIVE_RESERVE;

export type QuotaKind = "interactive" | "background";

/** One usage_events row's worth of information this module needs. */
export interface UsageEventLike {
  userId: string | null;
}

export interface UsageSplit {
  interactiveUsed: number;
  backgroundUsed: number;
}

/**
 * Splits today's usage_events rows into interactive (has a userId) vs
 * background (doesn't) — the one bit of information the split is built on.
 */
export function splitUsage(events: UsageEventLike[]): UsageSplit {
  let interactiveUsed = 0;
  let backgroundUsed = 0;
  for (const e of events) {
    if (e.userId) interactiveUsed += 1;
    else backgroundUsed += 1;
  }
  return { interactiveUsed, backgroundUsed };
}

export interface QuotaState {
  limit: number;
  usedToday: number;
  interactiveUsed: number;
  backgroundUsed: number;
  /** max(0, BACKGROUND_BUDGET - backgroundUsed). */
  backgroundRemaining: number;
  /** Set once a DAILY-exhaustion 429 is observed; null while healthy. While
   * `now` is before this, EVERY caller is blocked — see isGloballyExhausted. */
  exhaustedUntil: Date | null;
}

/** Assembles the full quota snapshot from a usage split + exhaustion state.
 * Pure — the DB reads that produce its inputs live in src/services/quota.ts. */
export function computeQuotaState(opts: {
  interactiveUsed: number;
  backgroundUsed: number;
  exhaustedUntil: Date | null;
}): QuotaState {
  const { interactiveUsed, backgroundUsed, exhaustedUntil } = opts;
  return {
    limit: GEMINI_FREE_TIER_RPD,
    usedToday: interactiveUsed + backgroundUsed,
    interactiveUsed,
    backgroundUsed,
    backgroundRemaining: Math.max(0, BACKGROUND_BUDGET - backgroundUsed),
    exhaustedUntil,
  };
}

/** True while `now` is still inside a recorded daily-exhaustion window — the
 * "don't try anything unnecessarily" gate: every canSpend() check fails
 * closed during this window, regardless of kind or remaining split budget. */
export function isGloballyExhausted(
  exhaustedUntil: Date | null,
  now: Date,
): boolean {
  return exhaustedUntil !== null && now.getTime() < exhaustedUntil.getTime();
}

/**
 * Can a call of this `kind` fire right now, given `state`?
 *  - Globally exhausted (a recent daily 429) -> false for everyone.
 *  - `background` -> false once its slice of the budget is spent, and also
 *    once the WHOLE day's cap is reached (e.g. an unusually heavy interactive
 *    day) — background never knowingly fires into a guaranteed 429.
 *  - `interactive` -> true otherwise; it owns its reserve outright and is
 *    never blocked by the background split. (Deliberately permissive at the
 *    boundary: our count can lag reality, and a failed interactive call fails
 *    fast into markExhausted anyway.)
 */
export function canSpend(
  kind: QuotaKind,
  state: QuotaState,
  now: Date,
): boolean {
  if (isGloballyExhausted(state.exhaustedUntil, now)) return false;
  if (kind === "background") {
    return state.backgroundRemaining > 0 && state.usedToday < state.limit;
  }
  return true;
}

/** Start of the UTC calendar day containing `d` — the boundary the daily cap
 * resets on. */
export function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** Start of the UTC calendar day AFTER the one containing `d` — used as the
 * exhaustion fallback when a 429's retry-after can't be parsed (safer to
 * assume "the rest of today" than to guess a short number and retry into
 * another wasted 429). */
export function startOfNextUtcDay(d: Date): Date {
  const start = startOfUtcDay(d);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}
