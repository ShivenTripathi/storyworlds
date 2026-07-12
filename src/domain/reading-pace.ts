/**
 * Pure arithmetic for the reader's "time left in chapter / book" estimate —
 * no I/O, no LLM call, no new persisted data. Inputs are things the reader
 * already has on screen: the current chunk index, the book's total chunk
 * count, a per-chunk word-count table (see the `/toc` route, which derives
 * it from the same chunk scan that finds chapter headings), and the sorted
 * chunk indices where a titled chapter heading begins.
 *
 * Reading speed defaults to a standard adult silent-reading estimate
 * (~250 wpm) — a constant, not measured; CLAUDE.md's zero-cost/no-schema
 * constraint rules out persisting an observed pace for this wave.
 */

export const DEFAULT_WPM = 250;

export interface TimeLeftEstimate {
  /** Words from the current chunk (inclusive) up to (not including) the next
   * chapter heading — null when the reader is already in the last chapter,
   * or no chapter headings were detected at all. */
  wordsToNextChapter: number | null;
  /** Words from the current chunk (inclusive) to the end of the book. */
  wordsToEnd: number;
  minutesToNextChapter: number | null;
  minutesToEnd: number;
}

/** Sum of `wordCounts[from..to]` (inclusive), tolerant of a shorter/sparser
 * array than the requested range (missing entries count as 0 words). */
function sumWords(wordCounts: number[], from: number, to: number): number {
  let total = 0;
  for (let i = Math.max(0, from); i <= to; i++) {
    total += wordCounts[i] ?? 0;
  }
  return total;
}

/**
 * Estimates remaining reading time from the current position to the next
 * chapter break and to the end of the book. The current chunk counts fully
 * toward "remaining" (the reader isn't tracked at sub-page granularity), so
 * this is deliberately a slight over-estimate right after a page turn and
 * converges to accurate as the reader nears a boundary — the same trade-off
 * Kindle's own location-based estimate makes.
 */
export function estimateTimeLeft(
  currentChunk: number,
  totalChunks: number,
  wordCounts: number[],
  chapterChunkIndices: number[],
  wpm: number = DEFAULT_WPM,
): TimeLeftEstimate {
  const lastChunk = Math.max(0, totalChunks - 1);
  const wordsToEnd = sumWords(wordCounts, currentChunk, lastChunk);

  const nextChapterIdx = chapterChunkIndices
    .filter((idx) => idx > currentChunk)
    .sort((a, b) => a - b)[0];
  const wordsToNextChapter =
    nextChapterIdx !== undefined
      ? sumWords(wordCounts, currentChunk, nextChapterIdx - 1)
      : null;

  const safeWpm = wpm > 0 ? wpm : DEFAULT_WPM;
  return {
    wordsToNextChapter,
    wordsToEnd,
    minutesToNextChapter:
      wordsToNextChapter != null
        ? Math.max(1, Math.round(wordsToNextChapter / safeWpm))
        : null,
    minutesToEnd: Math.max(1, Math.round(wordsToEnd / safeWpm)),
  };
}

/** Formats a minute count as a compact "X min" / "Xh Ym" label. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
