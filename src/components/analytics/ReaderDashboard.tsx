"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Mirrors ReaderStatsDto (src/services/analytics.ts) — kept as a local type
 * rather than importing server code into a client bundle.
 */
interface ReaderStats {
  booksStarted: number;
  booksFinished: number;
  booksInProgress: number;
  totalPagesRead: number;
  totalWordsRead: number;
  castMet: number;
  mostChattedCharacter: {
    bookId: string;
    entityId: string;
    name: string;
    messageCount: number;
  } | null;
  readingStreakDays: number;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; stats: ReaderStats };

// The streak strip renders one dot per consecutive day, capped so a long
// streak reads as "a lot" rather than sprawling off the card.
const STREAK_DOTS_CAP = 14;

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * The shelf's "Your Reading" dashboard (docs/analytics-plan.md Tier 1):
 * books started/finished/in-progress, pages & words read, cast met, a
 * reading-streak strip, and the most-chatted character. Fetches
 * GET /api/me/stats.
 */
export function ReaderDashboard({ className = "" }: { className?: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/stats", { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        return res.json() as Promise<{ stats: ReaderStats }>;
      })
      .then(({ stats }) => {
        if (!cancelled) setState({ status: "ready", stats });
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
      <div className={`space-y-3 ${className}`} aria-busy="true">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-border bg-card"
            />
          ))}
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <p
        className={`font-ui text-sm text-muted-foreground italic ${className}`}
      >
        Couldn&rsquo;t load your reading stats — try again shortly.
      </p>
    );
  }

  const { stats } = state;
  const streakDots = Math.min(stats.readingStreakDays, STREAK_DOTS_CAP);
  const streakOverflow = Math.max(0, stats.readingStreakDays - STREAK_DOTS_CAP);

  return (
    <div className={`space-y-4 ${className}`}>
      <p className="eyebrow">Your Reading</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Books started"
          value={formatCount(stats.booksStarted)}
          detail={`${formatCount(stats.booksInProgress)} in progress · ${formatCount(stats.booksFinished)} finished`}
        />
        <StatTile
          label="Pages read"
          value={formatCount(stats.totalPagesRead)}
        />
        <StatTile
          label="Words read"
          value={formatCount(stats.totalWordsRead)}
        />
        <StatTile label="Cast met" value={formatCount(stats.castMet)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="eyebrow mb-2">Reading streak</p>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl text-foreground tabular-nums">
              {stats.readingStreakDays}
            </span>
            <span className="font-ui text-xs text-muted-foreground">
              {stats.readingStreakDays === 1 ? "day" : "days"}
            </span>
          </div>
          {stats.readingStreakDays > 0 ? (
            <div
              className="mt-3 flex flex-wrap items-center gap-1"
              role="img"
              aria-label={`${stats.readingStreakDays} consecutive day streak`}
            >
              {Array.from({ length: streakDots }).map((_, i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full bg-primary"
                  aria-hidden="true"
                />
              ))}
              {streakOverflow > 0 ? (
                <span className="font-ui text-xs text-muted-foreground">
                  +{streakOverflow}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 font-ui text-xs text-muted-foreground italic">
              Read today to start a new streak.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="eyebrow mb-2">Most-chatted character</p>
          {stats.mostChattedCharacter ? (
            <Link
              href={`/books/${stats.mostChattedCharacter.bookId}/characters/${stats.mostChattedCharacter.entityId}`}
              className="group -m-1 flex items-center justify-between gap-2 rounded-md p-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="font-display text-base text-foreground group-hover:underline">
                {stats.mostChattedCharacter.name}
              </span>
              <span className="font-ui text-xs text-muted-foreground tabular-nums">
                {formatCount(stats.mostChattedCharacter.messageCount)} msgs
              </span>
            </Link>
          ) : (
            <p className="font-ui text-xs text-muted-foreground italic">
              Chat with a character to see them here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="eyebrow mb-1">{label}</p>
      <p className="font-display text-2xl text-foreground tabular-nums">
        {value}
      </p>
      {detail ? (
        <p className="mt-1 font-ui text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}
