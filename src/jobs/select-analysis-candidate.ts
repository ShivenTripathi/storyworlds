/**
 * Pure selection logic for the analysis sweeper (src/jobs/sweep-analysis.ts).
 * DB-free so the "which book gets analyzed next" decision — the part most
 * worth getting right and easiest to get subtly wrong — is directly
 * unit-testable. See src/jobs/__tests__/select-analysis-candidate.test.ts.
 */
import {
  classifyPriorityTier,
  sortByPriority,
  type PriorityBookFields,
} from "./priority";

export type AnalyzeJobStatus = "queued" | "running" | "completed" | "failed";

export interface AnalysisCandidateInput extends PriorityBookFields {
  bookId: string;
  /** Book row creation time — tie-breaker (oldest first) within a priority tier. */
  createdAt: Date;
  /**
   * The most recent `analyze_book` job ever created for this book, if any.
   * `null` means the book has never had an analysis attempt.
   */
  lastJob: { status: AnalyzeJobStatus; updatedAt: Date } | null;
  /** Count of `analyze_book` jobs for this book with status='failed'. */
  failedAttempts: number;
  /**
   * True when this book has never had a successful ('completed') world
   * reference — i.e. this would be its first-time analysis. False means a
   * completed world reference already exists and this candidate is only
   * present because it's stale (produced by an older PIPELINE_VERSION — see
   * analyze-book.ts) and is being re-analyzed as a backfill. Never-analyzed
   * books always win the scarce free-tier analysis quota over stale
   * backfill — see `selectNextBookForAnalysis` below.
   */
  neverAnalyzed: boolean;
}

export interface AnalysisSelectionOptions {
  now: Date;
  /** Minimum time since the last failure before a retry is attempted again. */
  cooldownMs: number;
  /** Once failedAttempts reaches this, the book is left for manual retry. */
  maxAttempts: number;
}

export interface AnalysisSelectionResult {
  /** The single next book to enqueue for analysis, or null if none is eligible. */
  bookId: string | null;
  /**
   * Books excluded because they've exhausted their retry budget — surfaced
   * so the admin queue view can flag them for a manual nudge rather than
   * silently looping forever.
   */
  needsManualRetry: string[];
}

/**
 * Whether `book` is currently a valid target for a fresh analyze_book
 * enqueue: no attempt in flight, and (if the last attempt failed) past its
 * cooldown and under the attempts cap.
 */
export function isBookEligibleForAnalysis(
  book: Pick<AnalysisCandidateInput, "lastJob" | "failedAttempts">,
  opts: AnalysisSelectionOptions,
): boolean {
  const { lastJob } = book;
  if (!lastJob) return true;
  if (lastJob.status === "queued" || lastJob.status === "running") {
    return false;
  }
  if (lastJob.status === "failed") {
    if (book.failedAttempts >= opts.maxAttempts) return false;
    const elapsedMs = opts.now.getTime() - lastJob.updatedAt.getTime();
    return elapsedMs >= opts.cooldownMs;
  }
  // status === "completed" but the caller still considers this book a
  // candidate (i.e. its world_reference isn't 'completed' either) — an
  // edge case (e.g. a crash between job completion and persistence) that's
  // safe to retry immediately since nothing failed.
  return true;
}

/**
 * Picks the single next book to enqueue for analysis from a pre-filtered
 * list of candidates (caller is responsible for the DB-level filter:
 * books.status='ready' AND (world_reference missing/not 'completed' OR
 * completed-but-stale-pipeline — see sweep-analysis.ts's loadAnalysisCandidates).
 * Catalog/published books are drained before private ones; oldest first
 * within a tier. Never returns a book that's already in flight, cooling
 * down after a failure, or over the retry cap.
 *
 * Never-analyzed candidates (`neverAnalyzed: true`) are always selected
 * before stale-pipeline re-analysis candidates, regardless of tier — a
 * reader waiting on their FIRST world reference always wins the scarce
 * free-tier quota over the self-healing backfill of an already-readable
 * book. Within each of those two groups, the usual tier/age ordering
 * applies.
 */
export function selectNextBookForAnalysis(
  candidates: AnalysisCandidateInput[],
  opts: AnalysisSelectionOptions,
): AnalysisSelectionResult {
  const needsManualRetry = candidates
    .filter(
      (b) =>
        b.lastJob?.status === "failed" && b.failedAttempts >= opts.maxAttempts,
    )
    .map((b) => b.bookId);

  const eligible = candidates.filter((b) => isBookEligibleForAnalysis(b, opts));

  const toPrioritized = (books: AnalysisCandidateInput[]) =>
    sortByPriority(
      books.map((b) => ({
        bookId: b.bookId,
        tier: classifyPriorityTier(b),
        createdAt: b.createdAt,
      })),
    );

  const neverAnalyzedFirst = toPrioritized(
    eligible.filter((b) => b.neverAnalyzed),
  );
  const staleBackfill = toPrioritized(eligible.filter((b) => !b.neverAnalyzed));

  const bookId =
    neverAnalyzedFirst[0]?.bookId ?? staleBackfill[0]?.bookId ?? null;

  return { bookId, needsManualRetry };
}
