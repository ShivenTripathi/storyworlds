import { and, eq } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, jobs, overlays, worldReferences } from "@/db/schema";
import { generateOverlayCore } from "@/services/overlays";
import { getFreeTierHeadroom, isHeadroomTooLow } from "@/services/queue";
import {
  nextMissingOverlayChunks,
  selectNextBookForOverlays,
  type OverlayBacklogBook,
} from "./overlay-gap";
import { inngest } from "./client";

/**
 * Always-on illustration sweeper. Overlays today are only warm-started (the
 * opening ~10 pages, in analyze-book.ts's pipeline) plus generated lazily as
 * a reader reaches a page. This proactively drains the rest of the corpus
 * over time: each tick generates one SMALL batch of pages for one analyzed
 * book, then stops — the next tick resumes wherever it left off, derived
 * fresh from the DB every time (no in-memory cursor, so it survives
 * restarts/redeploys for free).
 *
 * Best-effort per page: `generateOverlayCore` already fails a single page
 * to 'failed' without throwing past this sweeper (see the try/catch below),
 * so one bad page never wedges the sweep — the next tick just tries the
 * next missing index (a `status='failed'` row is itself a "not ready" gap
 * generateOverlayCore will retry on its own idempotent lock).
 */

const OVERLAY_SWEEP_BATCH_SIZE = 3;
// Keep this batch's own concurrency modest; see the running-analysis guard
// below for why the two sweepers are also kept mutually exclusive in time —
// together they respect the ZERO-COST CONSTRAINT's "≤3 concurrency" ceiling.
const OVERLAY_SWEEP_CONCURRENCY = 3;

export type SweepOverlaysResult =
  | { skipped: "low_headroom"; headroomPct: number }
  | { skipped: "analysis_running" }
  | { skipped: "none_eligible" }
  | { bookId: string; attempted: number[]; succeeded: number[] };

/**
 * Loads every fully-analyzed book with its total page count and ready-
 * overlay count — everything overlay-gap.ts's pure selector needs to pick
 * the next backlog to work on. One join + group-by, no per-book loop.
 */
async function loadOverlayBacklogBooks(): Promise<OverlayBacklogBook[]> {
  await dbReady;

  const rows = await db
    .select({
      bookId: books.id,
      createdAt: books.createdAt,
      catalogSource: books.catalogSource,
      visibility: books.visibility,
      pricingTier: books.pricingTier,
      totalChunks: books.totalChunks,
      readyOverlayCount: overlays.status,
    })
    .from(books)
    .innerJoin(
      worldReferences,
      and(
        eq(worldReferences.bookId, books.id),
        eq(worldReferences.status, "completed"),
      ),
    )
    .leftJoin(overlays, eq(overlays.bookId, books.id));

  // Roll the left-joined overlay rows up into one row per book — drizzle
  // doesn't have a clean typed `count(...) filter` shorthand alongside a
  // plain select of the joined column, so aggregate here in JS instead of
  // fighting the query builder for one extra query saved.
  const byBook = new Map<string, OverlayBacklogBook & { _seen: boolean }>();
  for (const r of rows) {
    let entry = byBook.get(r.bookId);
    if (!entry) {
      entry = {
        bookId: r.bookId,
        createdAt: r.createdAt,
        catalogSource: r.catalogSource,
        visibility: r.visibility,
        pricingTier: r.pricingTier,
        totalChunks: r.totalChunks ?? 0,
        readyOverlayCount: 0,
        _seen: true,
      };
      byBook.set(r.bookId, entry);
    }
    if (r.readyOverlayCount === "ready") entry.readyOverlayCount += 1;
  }

  return [...byBook.values()];
}

/** Run `worker` over `items` with at most `limit` in flight concurrently. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function next(): Promise<void> {
    const i = cursor;
    cursor += 1;
    if (i >= items.length) return;
    await worker(items[i]);
    return next();
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => next()));
}

/**
 * One sweep tick. Skips (rather than fights for the same free-tier
 * concurrency budget) while a full analyze_book run is actively in
 * progress — analysis alone already uses 3 concurrent LLM calls (see
 * analyze-book.ts), so the two sweepers stay mutually exclusive in time to
 * keep total concurrent Gemini calls at or under 3 system-wide.
 */
export async function sweepOverlaysOnce(): Promise<SweepOverlaysResult> {
  await dbReady;

  const headroom = await getFreeTierHeadroom();
  if (isHeadroomTooLow(headroom)) {
    console.log(
      `[sweep-overlays] skipping tick — free-tier headroom at ${headroom.headroomPct}%`,
    );
    return { skipped: "low_headroom", headroomPct: headroom.headroomPct };
  }

  const [runningAnalysis] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, "analyze_book"), eq(jobs.status, "running")))
    .limit(1);
  if (runningAnalysis) {
    return { skipped: "analysis_running" };
  }

  const backlogBooks = await loadOverlayBacklogBooks();
  const bookId = selectNextBookForOverlays(backlogBooks);
  if (!bookId) {
    return { skipped: "none_eligible" };
  }

  const book = backlogBooks.find((b) => b.bookId === bookId)!;

  const readyRows = await db
    .select({ chunkIdx: overlays.chunkIdx })
    .from(overlays)
    .where(and(eq(overlays.bookId, bookId), eq(overlays.status, "ready")));
  const readyChunkIdxs = readyRows.map((r) => r.chunkIdx);

  const targetIdxs = nextMissingOverlayChunks(
    book.totalChunks,
    readyChunkIdxs,
    OVERLAY_SWEEP_BATCH_SIZE,
  );

  const succeeded: number[] = [];
  await runWithConcurrency(
    targetIdxs,
    OVERLAY_SWEEP_CONCURRENCY,
    async (idx) => {
      try {
        const row = await generateOverlayCore(bookId, idx);
        if (row) succeeded.push(idx);
      } catch (err) {
        console.error(
          `[sweep-overlays] batch generation failed for book ${bookId} chunk ${idx}:`,
          err,
        );
      }
    },
  );

  return { bookId, attempted: targetIdxs, succeeded };
}

export const sweepOverlays = inngest.createFunction(
  {
    id: "sweep-overlays",
    concurrency: 1,
    triggers: [
      { cron: "TZ=UTC */2 * * * *" },
      { event: "overlay/sweep.requested" },
    ],
  },
  async ({ step }) => {
    const result = await step.run("sweep-once", () => sweepOverlaysOnce());
    console.log("[sweep-overlays]", result);
    return result;
  },
);
