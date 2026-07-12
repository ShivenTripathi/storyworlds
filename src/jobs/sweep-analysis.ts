import { and, isNull, ne, or, eq, inArray } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, jobs, worldReferences } from "@/db/schema";
import {
  getFreeTierHeadroom,
  isHeadroomTooLow,
  isReaderActive,
} from "@/services/queue";
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
  | { skipped: "low_headroom"; headroomPct: number }
  | { skipped: "readers_active" }
  | { skipped: "none_eligible"; needsManualRetry: string[] }
  | { enqueued: string; jobId: string };

/**
 * Loads every book that still needs analysis (status='ready' AND its
 * world_reference is missing or not 'completed'), each annotated with its
 * most recent analyze_book job (if any) and total failed-attempt count —
 * everything src/jobs/select-analysis-candidate.ts's pure selector needs.
 * Two fixed queries regardless of corpus size (no per-book fan-out).
 */
async function loadAnalysisCandidates(): Promise<AnalysisCandidateInput[]> {
  await dbReady;

  const candidateBooks = await db
    .select({
      bookId: books.id,
      createdAt: books.createdAt,
      catalogSource: books.catalogSource,
      visibility: books.visibility,
      pricingTier: books.pricingTier,
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
  }));
}

/**
 * One sweep tick: pace against free-tier headroom, pick the next book (if
 * any), enqueue its analysis. Never throws — the Inngest function wraps
 * this in a step so a transient DB hiccup just gets retried by Inngest.
 */
export async function sweepAnalysisOnce(): Promise<SweepAnalysisResult> {
  await dbReady;

  if (await isReaderActive()) {
    return { skipped: "readers_active" };
  }

  const headroom = await getFreeTierHeadroom();
  if (isHeadroomTooLow(headroom)) {
    console.log(
      `[sweep-analysis] skipping tick — free-tier headroom at ${headroom.headroomPct}%`,
    );
    return { skipped: "low_headroom", headroomPct: headroom.headroomPct };
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
