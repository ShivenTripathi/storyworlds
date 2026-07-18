import { and, isNull, lt, ne, or, eq, inArray } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, jobs, worldReferences } from "@/db/schema";
import { isReaderActive } from "@/services/queue";
import { canSpend } from "@/services/quota";
import {
  selectNextBookForAnalysis,
  type AnalysisCandidateInput,
  type AnalyzeJobStatus,
} from "./select-analysis-candidate";
import { inngest } from "./client";

/**
 * Always-on analysis sweeper (see CLAUDE.md ZERO-COST CONSTRAINT + the
 * background-analysis spec): every tick, finds the single highest-priority
 * book that still needs a world reference and kicks off its analysis.
 * `analyzeBook` (src/jobs/analyze-book.ts) has `concurrency: 1`, so this
 * sweeper's job is only to keep that pipe fed — the actual work is always
 * serialized. Self-draining: as long as un-analyzed books remain (and
 * budget allows), every tick advances the frontier by exactly one book.
 *
 * Mirrors src/jobs/catalog-ingest.ts's self-draining cron shape, but over
 * ALL books needing analysis (not just the curated Gutenberg seed) and with
 * explicit cooldown/attempts-cap handling for retryable failures (see
 * src/jobs/select-analysis-candidate.ts).
 */

const ANALYSIS_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ANALYSIS_ATTEMPTS = 3;

export type SweepAnalysisResult =
  | { skipped: "quota_exhausted" }
  | { skipped: "readers_active" }
  | { skipped: "analysis_in_flight" }
  | { skipped: "none_eligible"; needsManualRetry: string[] }
  | { enqueued: string; jobId: string };

// A 'running' analyze job that hasn't advanced its progress in this long has
// stalled (e.g. the Gemini free tier 429'd it into a dead retry loop) — mark
// it failed so it stops blocking the global-serialize gate below and can be
// retried later. A 'queued' job never picked up in this long is likewise dead.
const RUNNING_STALL_MS = 15 * 60 * 1000;
const QUEUED_STALL_MS = 10 * 60 * 1000;

/**
 * Loads every book that still needs analysis, each annotated with its most
 * recent analyze_book job (if any) and total failed-attempt count —
 * everything src/jobs/select-analysis-candidate.ts's pure selector needs.
 * Two fixed queries regardless of corpus size (no per-book fan-out).
 *
 * A book qualifies (status='ready' AND either):
 *   - its world_reference is missing or not 'completed' (never successfully
 *     analyzed — first-time analysis), or
 *   - its world_reference IS 'completed' but was produced by an older
 *     pipeline (`model_versions->>'pipeline'` missing or < PIPELINE_VERSION)
 *     — a stale-data backfill (see analyze-book.ts's PIPELINE_VERSION doc:
 *     this is how already-analyzed books self-correct the "world panel
 *     shows stuff from page 1" bug without a manual re-trigger per book).
 * `neverAnalyzed` on the returned candidate distinguishes the two so the
 * selector can prefer first-time analysis for the scarce free-tier quota.
 */
async function loadAnalysisCandidates(): Promise<AnalysisCandidateInput[]> {
  await dbReady;

  // Only NEVER-successfully-analyzed books. The stale-pipeline re-analysis
  // backfill was DISABLED after it caused a 429 storm: with only ~500
  // requests/day (see queue.ts) and one book costing ~15+ calls, auto
  // re-analyzing the whole corpus is unaffordable and starves everything
  // else. Stale worlds (analyzed before the page-anchor fix) are re-analyzed
  // on demand via the admin Retry button instead, one at a time.
  const candidateBooks = await db
    .select({
      bookId: books.id,
      createdAt: books.createdAt,
      catalogSource: books.catalogSource,
      visibility: books.visibility,
      pricingTier: books.pricingTier,
      worldStatus: worldReferences.status,
    })
    .from(books)
    .leftJoin(worldReferences, eq(worldReferences.bookId, books.id))
    .where(
      and(
        eq(books.status, "ready"),
        or(
          isNull(worldReferences.bookId),
          ne(worldReferences.status, "completed"),
        ),
      ),
    );

  if (candidateBooks.length === 0) return [];

  const candidateIds = candidateBooks.map((b) => b.bookId);
  const jobRows = await db
    .select({
      bookId: jobs.bookId,
      status: jobs.status,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .where(
      and(eq(jobs.kind, "analyze_book"), inArray(jobs.bookId, candidateIds)),
    );

  const lastJobByBook = new Map<
    string,
    { status: AnalyzeJobStatus; updatedAt: Date }
  >();
  const failedCountByBook = new Map<string, number>();
  for (const row of jobRows) {
    if (!row.bookId) continue;
    const status = (row.status ?? "queued") as AnalyzeJobStatus;
    if (status === "failed") {
      failedCountByBook.set(
        row.bookId,
        (failedCountByBook.get(row.bookId) ?? 0) + 1,
      );
    }
    const current = lastJobByBook.get(row.bookId);
    if (!current || row.updatedAt > current.updatedAt) {
      lastJobByBook.set(row.bookId, { status, updatedAt: row.updatedAt });
    }
  }

  return candidateBooks.map((b) => ({
    bookId: b.bookId,
    createdAt: b.createdAt,
    catalogSource: b.catalogSource,
    visibility: b.visibility,
    pricingTier: b.pricingTier,
    lastJob: lastJobByBook.get(b.bookId) ?? null,
    failedAttempts: failedCountByBook.get(b.bookId) ?? 0,
    // Anything other than a 'completed' world reference has never finished
    // a successful analysis (first-time or a previously failed/partial
    // attempt); a 'completed' one only reaches this list at all because it's
    // stale-pipeline (see the query above), never because it's fresh.
    neverAnalyzed: b.worldStatus !== "completed",
  }));
}

/**
 * One sweep tick: pace against free-tier headroom, pick the next book (if
 * any), enqueue its analysis. Never throws — the Inngest function wraps
 * this in a step so a transient DB hiccup just gets retried by Inngest.
 */
async function sweepAnalysisOnce(): Promise<SweepAnalysisResult> {
  await dbReady;

  // Reclaim stalled jobs first (always — even when readers are active) so dead
  // 'running' zombies from a prior overload don't block the pipe forever.
  const now = Date.now();
  await db
    .update(jobs)
    .set({ status: "failed", error: "Reclaimed: stalled with no progress." })
    .where(
      and(
        eq(jobs.kind, "analyze_book"),
        or(
          and(
            eq(jobs.status, "running"),
            lt(jobs.updatedAt, new Date(now - RUNNING_STALL_MS)),
          ),
          and(
            eq(jobs.status, "queued"),
            lt(jobs.updatedAt, new Date(now - QUEUED_STALL_MS)),
          ),
        ),
      ),
    );

  // GLOBAL SERIALIZE — the critical fix. Inngest's own concurrency:1 proved
  // unreliable under load (functions release the concurrency slot during their
  // retry-backoff sleeps, so a backlog of runs cycled CONCURRENTLY and slammed
  // the 15-request/minute free-tier cap → a 429 storm that also starved
  // interactive chat). Enforce it at the DB level: never enqueue a new
  // analysis while ANY analyze_book is queued or running, so exactly one runs
  // at a time and stays under the rate limit.
  const [inFlight] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, "analyze_book"),
        inArray(jobs.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (inFlight) {
    return { skipped: "analysis_in_flight" };
  }

  if (await isReaderActive()) {
    return { skipped: "readers_active" };
  }

  if (!(await canSpend("background"))) {
    console.log("[sweep-analysis] skipping tick — background quota exhausted");
    return { skipped: "quota_exhausted" };
  }

  const candidates = await loadAnalysisCandidates();
  const { bookId, needsManualRetry } = selectNextBookForAnalysis(candidates, {
    now: new Date(),
    cooldownMs: ANALYSIS_COOLDOWN_MS,
    maxAttempts: MAX_ANALYSIS_ATTEMPTS,
  });

  if (!bookId) {
    return { skipped: "none_eligible", needsManualRetry };
  }

  const [book] = await db
    .select({ ownerId: books.ownerId })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);

  const [job] = await db
    .insert(jobs)
    .values({
      bookId,
      userId: book?.ownerId ?? null,
      kind: "analyze_book",
      status: "queued",
      progress: 0,
      stage: "Queued…",
    })
    .returning();

  await inngest.send({
    name: "book/analyze.requested",
    data: { bookId, jobId: job.id },
  });

  return { enqueued: bookId, jobId: job.id };
}

export const sweepAnalysis = inngest.createFunction(
  {
    id: "sweep-analysis",
    // The sweeper only ever inserts one `jobs` row + sends one event per
    // tick — trivial work. `analyzeBook`'s own concurrency:1 is what
    // actually serializes the expensive part (the LLM calls).
    concurrency: 1,
    triggers: [
      { cron: "TZ=UTC */3 * * * *" },
      { event: "analysis/sweep.requested" },
    ],
  },
  async ({ step }) => {
    const result = await step.run("sweep-once", () => sweepAnalysisOnce());
    console.log("[sweep-analysis]", result);
    return result;
  },
);
