/**
 * Shared priority ordering for the background sweepers (analysis +
 * illustration). Pure, DB-free so it's directly unit-testable — see
 * src/jobs/__tests__/priority.test.ts.
 *
 * Mirrors the book classification in src/services/admin.ts's `classify`
 * (duplicated rather than imported — that file isn't in this feature's
 * file set, and the classification is tiny/stable) but renames the
 * "contribution" bucket to "published" to match this feature's spec
 * ("catalog + published first, then private").
 */

export type PriorityTier = "catalog" | "published" | "private";

export interface PriorityBookFields {
  catalogSource: string | null;
  visibility: string | null;
  pricingTier: string | null;
}

export interface PrioritizedBook {
  bookId: string;
  tier: PriorityTier;
  /** Book creation time — used as the tie-breaker (oldest first) within a tier. */
  createdAt: Date;
}

const TIER_RANK: Record<PriorityTier, number> = {
  catalog: 0,
  published: 1,
  private: 2,
};

/**
 * Auto-ingested Gutenberg seed books and user contributions to the shared
 * public library are prioritized over single-reader private books — the
 * analysis/illustration cost on those is amortized across every reader,
 * so draining them first benefits the most people per free-tier request
 * spent (see CLAUDE.md "THE MODEL" + ZERO-COST CONSTRAINT).
 */
export function classifyPriorityTier(book: PriorityBookFields): PriorityTier {
  if (book.catalogSource) return "catalog";
  if (
    book.pricingTier === "public_subsidized" ||
    book.visibility === "published"
  ) {
    return "published";
  }
  return "private";
}

/**
 * Sorts by tier (catalog, then published, then private), oldest-first
 * within a tier. Does not mutate its input.
 */
export function sortByPriority<T extends PrioritizedBook>(books: T[]): T[] {
  return [...books].sort((a, b) => {
    const tierDiff = TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
