/**
 * Maps a reader's stored highlights onto the `TextRun`s produced by
 * `src/domain/reader-format.ts`'s `formatChunk`, so the reading column can
 * render a highlight as a `<mark>` behind the matching text.
 *
 * DESIGN NOTE — why string matching instead of character offsets: offsets
 * captured at highlight-creation time (e.g. "chars 120-180 of the chunk")
 * would be brittle — any change to `formatChunk`'s reflow/paragraph-join
 * logic, or even the same text re-rendering with different whitespace
 * normalization, could silently shift them out of alignment with the text
 * they were meant to cover. Matching by the highlighted STRING itself is
 * simpler and self-healing: as long as the phrase still appears verbatim in
 * the chunk, the highlight renders in the right place, regardless of how the
 * surrounding blocks are laid out. The tradeoff: a highlight is matched to
 * its FIRST occurrence within a given block, so a phrase that repeats
 * verbatim within the same paragraph could (rarely) highlight the wrong
 * occurrence — acceptable for an MVP notebook feature.
 */

import type { TextRun } from "./reader-format";

export interface HighlightSource {
  id: string;
  text: string;
  color: string;
}

/** A `TextRun` that may additionally belong to a highlight. */
export interface HighlightedRun extends TextRun {
  highlightId?: string;
  color?: string;
}

/**
 * Splits `runs` (the runs of a single paragraph/block) so that any
 * substring matching a highlight's stored `text` is broken out into its own
 * run(s), tagged with `highlightId`/`color`, while every other run is
 * returned unchanged (italics preserved either way). Returns `runs` as-is
 * (no new array) when there's nothing to highlight, so callers can rely on
 * referential equality to skip re-render work.
 */
export function applyHighlightsToRuns(
  runs: TextRun[],
  highlightsForChunk: HighlightSource[],
): HighlightedRun[] {
  if (highlightsForChunk.length === 0 || runs.length === 0) return runs;

  const plain = runs.map((r) => r.text).join("");
  const bounds: { start: number; end: number }[] = [];
  let offset = 0;
  for (const r of runs) {
    bounds.push({ start: offset, end: offset + r.text.length });
    offset += r.text.length;
  }

  // Longest phrase first: reduces the chance a short highlight's text
  // happens to sit inside a longer highlight's span and steals it.
  const candidates = [...highlightsForChunk]
    .filter((h) => h.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length);

  const ranges: { start: number; end: number; highlight: HighlightSource }[] =
    [];
  for (const h of candidates) {
    const idx = plain.indexOf(h.text);
    if (idx === -1) continue;
    const start = idx;
    const end = idx + h.text.length;
    const overlaps = ranges.some((r) => start < r.end && end > r.start);
    if (overlaps) continue;
    ranges.push({ start, end, highlight: h });
  }
  if (ranges.length === 0) return runs;
  ranges.sort((a, b) => a.start - b.start);

  const out: HighlightedRun[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const { start: runStart, end: runEnd } = bounds[i];
    const intersecting = ranges.filter(
      (r) => r.start < runEnd && r.end > runStart,
    );
    if (intersecting.length === 0) {
      out.push(run);
      continue;
    }

    let cursor = runStart;
    for (const r of intersecting) {
      const segStart = Math.max(r.start, runStart);
      const segEnd = Math.min(r.end, runEnd);
      if (segStart > cursor) {
        out.push({
          text: run.text.slice(cursor - runStart, segStart - runStart),
          italic: run.italic,
        });
      }
      out.push({
        text: run.text.slice(segStart - runStart, segEnd - runStart),
        italic: run.italic,
        highlightId: r.highlight.id,
        color: r.highlight.color,
      });
      cursor = segEnd;
    }
    if (cursor < runEnd) {
      out.push({ text: run.text.slice(cursor - runStart), italic: run.italic });
    }
  }
  return out;
}
