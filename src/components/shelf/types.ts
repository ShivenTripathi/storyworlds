/**
 * Shared shelf/book-detail types, matching the /api/books contract exactly.
 * See CLAUDE.md + task brief for the contract; this file has no dependency
 * on src/services or src/db — it only describes the wire shape.
 */

export type BookStatus = "uploaded" | "extracting" | "ready" | "failed";

export interface BookProgress {
  currentChunk: number;
  frontierChunk: number;
  percent: number;
  lastReadAt?: string;
}

export interface Book {
  id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  totalChunks: number;
  totalWords: number;
  createdAt: string;
  visibility?: string | null;
  themeArchetype?: string | null;
  /** 'public_subsidized' | 'private_premium' | 'catalog' | null (legacy).
   * See CLAUDE.md "THE MODEL" — drives the upload dialog's pricing copy and
   * the Discover "contributed by a reader" badge. */
  pricingTier?: string | null;
  /** Spoiler-free back-cover teaser, generated during analysis. Null until
   * the book has been (re-)analyzed since blurb generation shipped — render
   * nothing when absent, never a placeholder. */
  blurb?: string | null;
  /** Spoiler-free "Did you know?" facts, generated during analysis (see
   * FunFactsSchema in src/domain/schemas.ts). Null/absent until generated —
   * render nothing, never a placeholder. */
  funFacts?: {
    facts: {
      text: string;
      category: "author" | "history" | "trivia" | "legacy";
    }[];
  } | null;
  /** URL of the generated cover illustration (src/services/cover.ts), or
   * null until one exists. Render the typographic fallback cover
   * (TypographicCover) while null. */
  coverUrl?: string | null;
  /** Present on /api/marketplace and /api/books responses: whether this
   * book is on the shelf because the caller owns it or added it from
   * Discover. */
  source?: "owned" | "library";
  progress?: BookProgress;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
