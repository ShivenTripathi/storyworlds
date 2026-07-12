"use client";

import { useEffect, useState } from "react";

/**
 * Mirrors ReadingActivityDto (src/services/analytics.ts) — kept as a local
 * type rather than importing server code into a client bundle.
 */
interface ActivityDay {
  day: string;
  wordsRead: number;
}

interface ReadingActivity {
  days: ActivityDay[];
  currentStreakDays: number;
  longestStreakDays: number;
  activeDays: number;
  totalWordsThisYear: number;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; activity: ReadingActivity };

const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;

// Token-based intensity ramp — color-mix'd from --world-accent into --muted
// so the heatmap always matches the active book-theme archetype (or the
// default palette outside any book context). No literal colors.
const LEVEL_FILLS = [
  "var(--muted)",
  "color-mix(in srgb, var(--world-accent) 30%, var(--muted))",
  "color-mix(in srgb, var(--world-accent) 55%, var(--muted))",
  "color-mix(in srgb, var(--world-accent) 78%, var(--muted))",
  "var(--world-accent)",
];

function levelFor(wordsRead: number, max: number): number {
  if (wordsRead <= 0 || max <= 0) return 0;
  const ratio = wordsRead / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function dateFromIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function formatDayLong(iso: string): string {
  return dateFromIso(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatMonthShort(iso: string): string {
  return dateFromIso(iso).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Lays the flat, chronological `days` list out into a GitHub-contribution-
 * style grid: columns are weeks, rows are weekdays (0=Sun..6=Sat), with
 * leading `null` padding so the first real day lands on its correct row.
 */
function toWeekColumns(days: ActivityDay[]): (ActivityDay | null)[][] {
  if (days.length === 0) return [];
  const firstDow = dateFromIso(days[0].day).getUTCDay();
  const padded: (ActivityDay | null)[] = [
    ...Array(firstDow).fill(null),
    ...days,
  ];
  const weeks: (ActivityDay | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }
  return weeks;
}

function monthLabels(
  weeks: (ActivityDay | null)[][],
): { weekIdx: number; label: string }[] {
  const labels: { weekIdx: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, weekIdx) => {
    const firstReal = week.find((d): d is ActivityDay => d !== null);
    if (!firstReal) return;
    const month = dateFromIso(firstReal.day).getUTCMonth();
    if (month !== lastMonth) {
      labels.push({ weekIdx, label: formatMonthShort(firstReal.day) });
      lastMonth = month;
    }
  });
  return labels;
}

const WEEKDAY_HINTS: { row: number; label: string }[] = [
  { row: 1, label: "Mon" },
  { row: 3, label: "Wed" },
  { row: 5, label: "Fri" },
];

/**
 * The GitHub-contribution-style reading heatmap (53 weeks x 7 days, inline
 * SVG) plus a streak card. Fetches GET /api/me/activity. Rendered
 * prominently on the Discoveries page, above ReaderDashboard.
 */
export function ReadingHeatmap({ className = "" }: { className?: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/activity", { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        return res.json() as Promise<{ activity: ReadingActivity }>;
      })
      .then(({ activity }) => {
        if (!cancelled) setState({ status: "ready", activity });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div
        className={`grid gap-3 sm:grid-cols-[1fr_auto] ${className}`}
        aria-busy="true"
      >
        <div className="h-32 animate-pulse rounded-lg border border-border bg-card" />
        <div className="h-32 w-full animate-pulse rounded-lg border border-border bg-card sm:w-56" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <p
        className={`font-ui text-sm text-muted-foreground italic ${className}`}
      >
        Couldn&rsquo;t load your reading heatmap — try again shortly.
      </p>
    );
  }

  const { activity } = state;
  const weeks = toWeekColumns(activity.days);
  const labels = monthLabels(weeks);
  const gridWidth = weeks.length * STEP;
  const gridHeight = 7 * STEP;
  const max = Math.max(1, ...activity.days.map((d) => d.wordsRead));

  return (
    <div className={className}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <p className="eyebrow">Reading heatmap</p>
        <p className="font-ui text-xs text-muted-foreground">
          {formatCount(activity.totalWordsThisYear)} words this year
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="overflow-x-auto rounded-lg border border-border bg-card p-4">
          <svg
            width={gridWidth + 28}
            height={gridHeight + 16}
            role="img"
            aria-label={`Reading activity heatmap: ${activity.activeDays} active days over the last year, current streak ${activity.currentStreakDays} ${activity.currentStreakDays === 1 ? "day" : "days"}`}
          >
            <g transform="translate(28,16)">
              {labels.map(({ weekIdx, label }) => (
                <text
                  key={weekIdx}
                  x={weekIdx * STEP}
                  y={-4}
                  className="fill-muted-foreground"
                  style={{ fontSize: 9 }}
                >
                  {label}
                </text>
              ))}
              {weeks.map((week, weekIdx) => (
                <g key={weekIdx} transform={`translate(${weekIdx * STEP},0)`}>
                  {week.map((cell, dow) =>
                    cell ? (
                      <rect
                        key={dow}
                        x={0}
                        y={dow * STEP}
                        width={CELL}
                        height={CELL}
                        rx={2}
                        fill={LEVEL_FILLS[levelFor(cell.wordsRead, max)]}
                      >
                        <title>
                          {`${formatDayLong(cell.day)} — ${formatCount(cell.wordsRead)} words`}
                        </title>
                      </rect>
                    ) : null,
                  )}
                </g>
              ))}
            </g>
            <g transform="translate(0,16)">
              {WEEKDAY_HINTS.map(({ row, label }) => (
                <text
                  key={label}
                  x={0}
                  y={row * STEP + CELL - 2}
                  className="fill-muted-foreground"
                  style={{ fontSize: 9 }}
                >
                  {label}
                </text>
              ))}
            </g>
          </svg>
        </div>

        <StreakCard activity={activity} />
      </div>
    </div>
  );
}

function StreakCard({ activity }: { activity: ReadingActivity }) {
  const { currentStreakDays, longestStreakDays, activeDays } = activity;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:min-w-[200px]">
      <div>
        <p className="eyebrow mb-1">Current streak</p>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-xl leading-none">
            {currentStreakDays > 0 ? "\u{1F525}" : "\u{1F4A4}"}
          </span>
          <span className="font-display text-2xl text-foreground tabular-nums">
            {currentStreakDays}
          </span>
          <span className="font-ui text-xs text-muted-foreground">
            {currentStreakDays === 1 ? "day" : "days"}
          </span>
        </div>
        <p className="mt-1 font-ui text-xs text-muted-foreground italic">
          {currentStreakDays > 0
            ? "Read today to keep it alive."
            : "Start a streak — read today."}
        </p>
      </div>

      <div className="border-t border-border pt-3">
        <p className="eyebrow mb-1">Longest streak</p>
        <p className="font-display text-lg text-foreground tabular-nums">
          {longestStreakDays} {longestStreakDays === 1 ? "day" : "days"}
        </p>
      </div>

      <div className="border-t border-border pt-3">
        <p className="eyebrow mb-1">Active days</p>
        <p className="font-display text-lg text-foreground tabular-nums">
          {formatCount(activeDays)}
        </p>
      </div>
    </div>
  );
}
