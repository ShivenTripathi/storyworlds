/**
 * Observability for the always-on background analysis/illustration
 * sweepers (src/jobs/sweep-analysis.ts, src/jobs/sweep-overlays.ts): what's
 * processing right now, how big the backlog is, free-tier headroom, and
 * recent failures with their real persisted error. Backs the admin
 * "Background queue" panel (src/components/admin/AdminQueue.tsx).
 *
 * Thin, no route/auth logic (see CLAUDE.md "Route handlers are thin") —
 * the route admin-gates this.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, dbReady } from "@/db";
import {
  books,
  jobs,
  overlays,
  readingProgress,
  usageEvents,
  worldReferences,
} from "@/db/schema";

// Google AI Studio free-tier daily request cap (see CLAUDE.md ZERO-COST
// CONSTRAINT). Duplicated from src/services/analytics.ts's
// GEMINI_FREE_TIER_RPD rather than imported — analytics.ts is owned by a
// parallel workstream on this branch, so this module stays decoupled from
// it (same value, same source of truth in CLAUDE.md).
const GEMINI_FREE_TIER_RPD = 1500;

/**
 * Below this remaining-headroom percentage, the sweepers skip their tick
 * entirely rather than start work that might tip the day over the free-tier
 * cap. Small requests still slip through elsewhere (chat, on-demand
 * overlays) so leaving a safety margin instead of pacing to exactly 0%
 * avoids the sweepers eating the last few percent readers might need.
 */
export const HEADROOM_SKIP_THRESHOLD_PCT = 10;

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export interface FreeTierHeadroom {
  requestsToday: number;
  dailyLimit: number;
  headroomPct: number;
}

/**
 * Today's Gemini free-tier request usage vs the daily cap. Both sweepers
 * check this before enqueuing/generating anything so the background system
 * paces itself and never blows the daily quota (see CLAUDE.md ZERO-COST
 * CONSTRAINT).
 */
export async function getFreeTierHeadroom(): Promise<FreeTierHeadroom> {
  await dbReady;

  const todayStart = startOfUtcDay(new Date());
  const [{ requestsToday }] = await db
    .select({ requestsToday: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, todayStart));

  const headroomPct = Math.max(
    0,
    Math.round(
      ((GEMINI_FREE_TIER_RPD - requestsToday) / GEMINI_FREE_TIER_RPD) * 100,
    ),
  );

  return { requestsToday, dailyLimit: GEMINI_FREE_TIER_RPD, headroomPct };
}

/** True when the sweepers should skip this tick rather than start new work. */
export function isHeadroomTooLow(headroom: FreeTierHeadroom): boolean {
  return headroom.headroomPct < HEADROOM_SKIP_THRESHOLD_PCT;
}

// A reader active within this window gets the free tier to themselves — the
// background sweeps pause so an interactive chat / on-read illustration is
// never rate-limited (15 RPM cap) by a background burst. The sweeps then run
// at full speed during the quiet stretches (e.g. overnight) to drain the
// corpus. `reading_progress.updatedAt` is a leading signal: it refreshes on
// every page turn while someone is reading (and a chatting reader is reading).
const READER_ACTIVE_WINDOW_SECONDS = 240;

/**
 * True when any reader has made progress in the last few minutes — meaning
 * interactive Gemini traffic (chat, on-demand overlays) is likely in flight,
 * so the background sweepers should yield this tick and not compete for the
 * per-minute rate limit.
 */
export async function isReaderActive(): Promise<boolean> {
  await dbReady;
  const since = new Date(Date.now() - READER_ACTIVE_WINDOW_SECONDS * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(readingProgress)
    .where(gte(readingProgress.updatedAt, since));
  return (row?.n ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// getQueueStatus
// ---------------------------------------------------------------------------

export interface QueueProcessingItem {
  jobId: string;
  bookId: string;
  title: string;
  stage: string | null;
  progress: number;
  startedAt: string;
}

export interface QueueFailureItem {
  jobId: string;
  bookId: string;
  title: string;
  error: string | null;
  failedAt: string;
  attempts: number;
  /** false once the book has exhausted MAX_ATTEMPTS — needs a manual retry
   * (see the "Retry analysis" action already on the books table). */
  willAutoRetry: boolean;
  cooldownEndsAt: string | null;
}

export interface QueueStatusDto {
  processing: QueueProcessingItem[];
  analysisBacklog: { pending: number; running: number; failed: number };
  analysis: { analyzed: number; totalReady: number };
  illustrations: {
    readyPages: number;
    totalPages: number;
    booksWithBacklog: number;
  };
  freeTier: FreeTierHeadroom;
  recentFailures: QueueFailureItem[];
  generatedAt: string;
}

// Mirrors the cooldown/attempts cap the analysis sweeper enforces (see
// src/jobs/select-analysis-candidate.ts) — kept as a local constant here
// too so the admin view's "will retry at…" projection matches the
// sweeper's actual behavior without importing across the jobs/services
// boundary just for two numbers.
const ANALYSIS_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_ANALYSIS_ATTEMPTS = 3;
const RECENT_FAILURES_LIMIT = 10;

/**
 * Full snapshot for the admin "Background queue" panel. Every aggregate
 * runs as a small fixed number of queries — no per-book fan-out loop — so
 * this stays cheap regardless of corpus size.
 */
export async function getQueueStatus(): Promise<QueueStatusDto> {
  await dbReady;

  const [
    processingRows,
    backlogRows,
    analyzedRow,
    totalReadyRow,
    illustrationRows,
    failureRows,
    freeTier,
  ] = await Promise.all([
    db
      .select({
        jobId: jobs.id,
        bookId: jobs.bookId,
        title: books.title,
        stage: jobs.stage,
        progress: jobs.progress,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .innerJoin(books, eq(books.id, jobs.bookId))
      .where(and(eq(jobs.kind, "analyze_book"), eq(jobs.status, "running")))
      .orderBy(desc(jobs.updatedAt)),

    db
      .select({ status: jobs.status, n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(eq(jobs.kind, "analyze_book"))
      .groupBy(jobs.status),

    db
      .select({ n: sql<number>`count(*)::int` })
      .from(worldReferences)
      .where(eq(worldReferences.status, "completed")),

    db
      .select({ n: sql<number>`count(*)::int` })
      .from(books)
      .where(eq(books.status, "ready")),

    db
      .select({
        bookId: books.id,
        totalChunks: books.totalChunks,
        readyOverlays: sql<number>`count(${overlays.bookId}) filter (where ${overlays.status} = 'ready')::int`,
      })
      .from(books)
      .innerJoin(
        worldReferences,
        and(
          eq(worldReferences.bookId, books.id),
          eq(worldReferences.status, "completed"),
        ),
      )
      .leftJoin(overlays, eq(overlays.bookId, books.id))
      .groupBy(books.id, books.totalChunks),

    db
      .select({
        jobId: jobs.id,
        bookId: jobs.bookId,
        title: books.title,
        error: jobs.error,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .innerJoin(books, eq(books.id, jobs.bookId))
      .where(and(eq(jobs.kind, "analyze_book"), eq(jobs.status, "failed")))
      .orderBy(desc(jobs.updatedAt))
      .limit(RECENT_FAILURES_LIMIT),

    getFreeTierHeadroom(),
  ]);

  const backlogByStatus = new Map(backlogRows.map((r) => [r.status, r.n]));

  const illustrationTotals = illustrationRows.reduce(
    (acc, r) => {
      const total = r.totalChunks ?? 0;
      const ready = Math.min(r.readyOverlays, total);
      acc.totalPages += total;
      acc.readyPages += ready;
      if (ready < total) acc.booksWithBacklog += 1;
      return acc;
    },
    { readyPages: 0, totalPages: 0, booksWithBacklog: 0 },
  );

  // Failed-attempt counts per book, for the "will this auto-retry" + cooldown
  // projection shown alongside each recent failure.
  const failureBookIds = [...new Set(failureRows.map((r) => r.bookId))].filter(
    (id): id is string => id !== null,
  );
  const attemptCounts = failureBookIds.length
    ? await db
        .select({ bookId: jobs.bookId, n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(
          and(
            eq(jobs.kind, "analyze_book"),
            eq(jobs.status, "failed"),
            inArray(jobs.bookId, failureBookIds),
          ),
        )
        .groupBy(jobs.bookId)
    : [];
  const attemptsByBook = new Map(attemptCounts.map((r) => [r.bookId, r.n]));

  const now = Date.now();
  const recentFailures: QueueFailureItem[] = failureRows.map((r) => {
    const attempts = r.bookId ? (attemptsByBook.get(r.bookId) ?? 1) : 1;
    const willAutoRetry = attempts < MAX_ANALYSIS_ATTEMPTS;
    const cooldownEndsAt = new Date(
      r.updatedAt.getTime() + ANALYSIS_COOLDOWN_MS,
    );
    return {
      jobId: r.jobId,
      bookId: r.bookId ?? "",
      title: r.title,
      error: r.error,
      failedAt: r.updatedAt.toISOString(),
      attempts,
      willAutoRetry,
      cooldownEndsAt:
        willAutoRetry && cooldownEndsAt.getTime() > now
          ? cooldownEndsAt.toISOString()
          : null,
    };
  });

  return {
    processing: processingRows.map((r) => ({
      jobId: r.jobId,
      bookId: r.bookId ?? "",
      title: r.title,
      stage: r.stage,
      progress: r.progress ?? 0,
      startedAt: r.createdAt.toISOString(),
    })),
    analysisBacklog: {
      pending: backlogByStatus.get("queued") ?? 0,
      running: backlogByStatus.get("running") ?? 0,
      failed: backlogByStatus.get("failed") ?? 0,
    },
    analysis: {
      analyzed: analyzedRow[0]?.n ?? 0,
      totalReady: totalReadyRow[0]?.n ?? 0,
    },
    illustrations: illustrationTotals,
    freeTier: freeTier,
    recentFailures,
    generatedAt: new Date().toISOString(),
  };
}
