/**
 * Spoiler gating: given a reader's frontier (max chunk they've ever reached),
 * filter out items introduced later in the book. `introducedAtChunk == null`
 * means "safe/unknown" and is always visible — we never withhold content we
 * can't confidently place past the frontier.
 */

export function frontierFilter<T extends { introducedAtChunk?: number | null }>(
  items: T[],
  frontierChunk: number,
): T[] {
  return items.filter(
    (item) =>
      item.introducedAtChunk == null || item.introducedAtChunk <= frontierChunk,
  );
}
