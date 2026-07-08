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
