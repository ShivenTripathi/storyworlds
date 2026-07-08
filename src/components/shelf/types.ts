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
  progress?: BookProgress;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
