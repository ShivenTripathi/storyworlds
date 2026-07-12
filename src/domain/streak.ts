/**
 * Pure UTC-day + streak math for the reading heatmap (src/services/
 * analytics.ts getReadingActivity, src/components/analytics/
 * ReadingHeatmap.tsx). No imports from db/ or ai/ — unit-testable without a
 * database (see src/domain/__tests__/streak.test.ts).
 *
 * Days are always represented as 'YYYY-MM-DD' UTC calendar-day strings (the
 * same shape Postgres `date` columns round-trip as with drizzle's
 * `{ mode: 'string' }` — see reading_activity in src/db/schema.ts), which
 * sort and diff correctly with plain string/arithmetic ops and sidestep any
 * local-timezone `Date` coercion entirely.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A single day's rollup — mirrors one `reading_activity` row. */
export interface DayActivity {
  /** UTC calendar day, 'YYYY-MM-DD'. */
  day: string;
  wordsRead: number;
}

export interface StreakResult {
  /** Consecutive UTC days with wordsRead > 0, counting back from today —
   * or from yesterday if today has no activity yet, so the streak doesn't
   * look "broken" before the reader has had a chance to read today. */
  currentStreakDays: number;
  /** The longest run of consecutive active days anywhere in the input. */
  longestStreakDays: number;
  /** Count of distinct days with wordsRead > 0. */
  activeDays: number;
}

/** Formats a Date as its UTC calendar-day string, 'YYYY-MM-DD'. */
export function utcDayString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function parseUtcDayMs(dayIso: string): number {
  const [y, m, d] = dayIso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Adds `delta` UTC calendar days (may be negative) to a day string. */
export function addUtcDays(dayIso: string, delta: number): string {
  return utcDayString(new Date(parseUtcDayMs(dayIso) + delta * MS_PER_DAY));
}

/**
 * Computes current/longest streaks + active-day count from a list of daily
 * rollups. Handles a sparse input (only some days present, gaps allowed —
 * a missing day is treated identically to a present day with wordsRead=0)
 * as well as a fully gap-filled input; both are valid inputs.
 *
 * `todayIso` defaults to the real current UTC day but is injectable so the
 * "today vs. yesterday" boundary is deterministically testable.
 */
export function computeStreaks(
  days: DayActivity[],
  todayIso: string = utcDayString(),
): StreakResult {
  const activeDays = new Set(
    days.filter((d) => d.wordsRead > 0).map((d) => d.day),
  );

  if (activeDays.size === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0, activeDays: 0 };
  }

  const sortedActive = [...activeDays].sort(); // ISO strings sort chronologically

  let longestStreakDays = 1;
  let run = 1;
  for (let i = 1; i < sortedActive.length; i++) {
    const gapDays =
      (parseUtcDayMs(sortedActive[i]) - parseUtcDayMs(sortedActive[i - 1])) /
      MS_PER_DAY;
    run = gapDays === 1 ? run + 1 : 1;
    if (run > longestStreakDays) longestStreakDays = run;
  }

  // Current streak anchors on today if it's active, else yesterday (so
  // reading today doesn't retroactively look required to "not break" the
  // streak before it's logged) — otherwise the streak has lapsed.
  let anchorIso: string;
  if (activeDays.has(todayIso)) {
    anchorIso = todayIso;
  } else {
    const yesterdayIso = addUtcDays(todayIso, -1);
    if (!activeDays.has(yesterdayIso)) {
      return {
        currentStreakDays: 0,
        longestStreakDays,
        activeDays: activeDays.size,
      };
    }
    anchorIso = yesterdayIso;
  }

  let currentStreakDays = 0;
  let cursor = anchorIso;
  while (activeDays.has(cursor)) {
    currentStreakDays += 1;
    cursor = addUtcDays(cursor, -1);
  }

  return { currentStreakDays, longestStreakDays, activeDays: activeDays.size };
}

/**
 * The forward-only rule for reading-activity instrumentation (src/services/
 * books.ts recordReadingActivity): a frontier advance from `priorFrontier`
 * to `newFrontier` only counts the NEWLY read chunks. Returns null when the
 * frontier didn't move forward (re-reading an already-read chunk, or no
 * movement), so a caller never double-counts.
 *
 * `priorFrontier` is the reader's previous frontier chunk index, or -1 if
 * they have no prior progress row (so chunk 0 counts as newly read).
 */
export function forwardReadRange(
  priorFrontier: number,
  newFrontier: number,
): { fromIdx: number; toIdx: number } | null {
  if (newFrontier <= priorFrontier) return null;
  return { fromIdx: priorFrontier + 1, toIdx: newFrontier };
}
