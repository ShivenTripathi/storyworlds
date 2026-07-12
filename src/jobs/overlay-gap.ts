/**
 * Pure helpers for the illustration sweeper (src/jobs/sweep-overlays.ts):
 * which book has the biggest illustration gap, and which of its pages to
 * generate next. DB-free so both are directly unit-testable — see
 * src/jobs/__tests__/overlay-gap.test.ts.
 */
import {
  classifyPriorityTier,
  sortByPriority,
  type PriorityBookFields,
} from "./priority";

export interface OverlayBacklogBook extends PriorityBookFields {
  bookId: string;
  createdAt: Date;
  totalChunks: number;
  /** Count of overlay rows for this book with status='ready'. */
  readyOverlayCount: number;
}

/**
 * Picks the next book to illustrate: catalog/published before private,
 * oldest first within a tier, skipping any book that's already fully
 * illustrated (readyOverlayCount >= totalChunks).
 */
export function selectNextBookForOverlays(
  candidates: OverlayBacklogBook[],
): string | null {
  const withGaps = candidates.filter(
    (b) => b.totalChunks > 0 && b.readyOverlayCount < b.totalChunks,
  );
  const prioritized = sortByPriority(
    withGaps.map((b) => ({
      bookId: b.bookId,
      tier: classifyPriorityTier(b),
      createdAt: b.createdAt,
    })),
  );
  return prioritized[0]?.bookId ?? null;
}

/**
 * Given a book's total page count and the chunk indices that already have
 * a 'ready' overlay, returns the next `batchSize` chunk indices (ascending)
 * that still need one. Resumable by construction: callers just re-derive
 * `readyChunkIdxs` from the DB on every tick — no cursor/offset state to
 * persist anywhere.
 */
export function nextMissingOverlayChunks(
  totalChunks: number,
  readyChunkIdxs: Iterable<number>,
  batchSize: number,
): number[] {
  const ready = new Set(readyChunkIdxs);
  const missing: number[] = [];
  for (let idx = 0; idx < totalChunks && missing.length < batchSize; idx++) {
    if (!ready.has(idx)) missing.push(idx);
  }
  return missing;
}
