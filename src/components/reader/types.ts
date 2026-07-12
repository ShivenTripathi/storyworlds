// Shared types for the Reader surface. These mirror the API contract for
// GET /api/books/{id}, GET /api/books/{id}/chunks/{idx}, and
// PUT /api/books/{id}/progress.

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  status: string;
  totalChunks: number | null;
  totalWords: number | null;
  createdAt: string;
  /** Present once the book's world has been analyzed; drives the reader's per-book theme. */
  themeArchetype?: string | null;
}

export interface ReadingProgress {
  currentChunk: number;
  frontierChunk: number;
}

export interface ChunkPayload {
  idx: number;
  pageNumber: number | null;
  text: string;
  totalChunks: number;
}

export interface BookResponse {
  book: BookSummary;
  progress: ReadingProgress;
}

/** One chapter/section heading, located to the chunk it opens — mirrors
 * `src/domain/reader-format.ts`'s `TocHeading`. */
export interface TocChapter {
  title: string;
  chunkIdx: number;
}

/** GET /api/books/{id}/toc response — table-of-contents entries plus a
 * per-chunk word-count table the reader's "time left" estimate is computed
 * from client-side (see src/domain/reading-pace.ts). */
export interface TocResponse {
  chapters: TocChapter[];
  wordCounts: number[];
}
