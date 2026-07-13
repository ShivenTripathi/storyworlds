/**
 * Content-addressed cache of raw per-segment LLM analysis results — the
 * amortization + resumability layer for the book-analysis pipeline (see
 * src/jobs/analyze-book.ts's segment loop).
 *
 * AMORTIZATION: the cache key is sha256(segment text + SEGMENT_PROMPT_
 * VERSION), not (bookId, segmentIndex) — so the SAME segment text is
 * analyzed at most ONCE, ever. A re-analysis of the same book (a pipeline-
 * version backfill) reuses every segment's cached result; a different book
 * that happens to share text (e.g. a shared front-matter boilerplate,
 * near-duplicate catalog editions) reuses it too.
 *
 * RESUMABILITY: when a run is aborted mid-way because the background quota
 * ran out (see the segment loop's canSpend('background') check), whatever
 * segments it finished are already in this cache. The next attempt (the
 * analysis sweeper's cooldown retry, or a manual retry) re-computes the same
 * hashes, hits the cache for everything already done, and only spends fresh
 * quota on the segments that are still missing.
 *
 * Thin — no route/auth logic (see CLAUDE.md "Route handlers are thin").
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { SEGMENT_PROMPT_VERSION } from "@/ai/prompts/segment";
import { SYNTHESIS_PROMPT_VERSION } from "@/ai/prompts/synthesis";
import { db, dbReady } from "@/db";
import { segmentCache } from "@/db/schema";
import type { SegmentAnalysis, WorldSynthesis } from "@/domain/schemas";

/** Looks up a cached result by content hash. Returns null on a miss — never
 * throws on a lookup failure past dbReady issues, since a cache miss is a
 * completely normal, expected outcome. */
async function getCachedResult<T>(hash: string): Promise<T | null> {
  await dbReady;
  const [row] = await db
    .select({ result: segmentCache.result })
    .from(segmentCache)
    .where(eq(segmentCache.hash, hash))
    .limit(1);
  return (row?.result as T | undefined) ?? null;
}

/** Writes a fresh result to the cache. Idempotent — a concurrent write for
 * the same hash (identical content analyzed twice in the same run) just
 * no-ops on the second write rather than erroring, since the content — and
 * therefore the result — is the same. */
async function putCachedResult(hash: string, result: unknown): Promise<void> {
  await dbReady;
  await db
    .insert(segmentCache)
    .values({ hash, result })
    .onConflictDoNothing({ target: segmentCache.hash });
}

/**
 * The cache key for a segment: sha256 of its raw text plus the current
 * segment-prompt version, so a prompt/schema change invalidates old cache
 * entries automatically (they simply stop matching any future hash) without
 * needing to delete rows.
 */
export function computeSegmentHash(text: string): string {
  return createHash("sha256")
    .update(`segment:${SEGMENT_PROMPT_VERSION}:${text}`)
    .digest("hex");
}

export async function getCachedSegment(
  hash: string,
): Promise<SegmentAnalysis | null> {
  return getCachedResult<SegmentAnalysis>(hash);
}

export async function putCachedSegment(
  hash: string,
  result: SegmentAnalysis,
): Promise<void> {
  return putCachedResult(hash, result);
}

/**
 * The cache key for a whole-book synthesis: sha256 of the book title + the
 * aggregated notes digest (built from every segment's result) plus the
 * current synthesis-prompt version. Synthesis isn't segment-shaped, but a
 * retry that lands on an identical notes digest (e.g. every segment was
 * already cached) shouldn't re-spend a call recomputing the same synthesis.
 */
export function computeSynthesisHash(opts: {
  bookTitle: string;
  notesDigest: string;
}): string {
  return createHash("sha256")
    .update(
      `synthesis:${SYNTHESIS_PROMPT_VERSION}:${opts.bookTitle}:${opts.notesDigest}`,
    )
    .digest("hex");
}

export async function getCachedSynthesis(
  hash: string,
): Promise<WorldSynthesis | null> {
  return getCachedResult<WorldSynthesis>(hash);
}

export async function putCachedSynthesis(
  hash: string,
  result: WorldSynthesis,
): Promise<void> {
  return putCachedResult(hash, result);
}

/**
 * Thrown when the segment loop hits a segment that isn't cached and the
 * background quota is exhausted. Deliberately NOT retried inline — the
 * caller (analyzeBook's Inngest function) lets this fail the job cleanly;
 * the analysis sweeper's existing cooldown/retry (src/jobs/sweep-
 * analysis.ts) picks it back up later, at which point every segment
 * completed so far is a cache hit (see the module doc above).
 */
export class QuotaPausedError extends Error {
  constructor(reason: string) {
    super(`paused: quota — ${reason}`);
    this.name = "QuotaPausedError";
  }
}
