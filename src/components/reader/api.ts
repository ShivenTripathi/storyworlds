import type {
  BookmarkDto,
  BookResponse,
  ChunkPayload,
  HighlightDto,
  ReadingProgress,
  SearchHit,
  TocResponse,
} from "./types";

/**
 * Thin fetch wrapper for the Reader's API contract. All routes are
 * same-origin and cookie-authed (Clerk) — no auth headers needed.
 */
export class ReaderApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ReaderApiError";
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as {
        error?: { message?: string };
      } | null;
      if (data?.error?.message) message = data.error.message;
    } catch {
      // response body wasn't JSON — fall back to statusText
    }
    throw new ReaderApiError(res.status, message);
  }

  return (await res.json()) as T;
}

export function fetchBook(bookId: string): Promise<BookResponse> {
  return request<BookResponse>(`/api/books/${bookId}`);
}

export function fetchChunk(bookId: string, idx: number): Promise<ChunkPayload> {
  return request<ChunkPayload>(`/api/books/${bookId}/chunks/${idx}`);
}

/** Table-of-contents entries + per-chunk word counts — fetched once per
 * reader session (see Reader.tsx), not on every page turn. */
export function fetchToc(bookId: string): Promise<TocResponse> {
  return request<TocResponse>(`/api/books/${bookId}/toc`);
}

/** URL + JSON body for a progress PUT, shared by the async helper and the
 * synchronous `keepalive` flush on pagehide/visibilitychange. */
export function progressRequest(
  bookId: string,
  currentChunk: number,
  frontierChunk?: number,
): { url: string; body: string } {
  return {
    url: `/api/books/${bookId}/progress`,
    body: JSON.stringify({
      currentChunk,
      ...(frontierChunk != null ? { frontierChunk } : {}),
    }),
  };
}

export function putProgress(
  bookId: string,
  currentChunk: number,
  frontierChunk?: number,
): Promise<ReadingProgress> {
  const { url, body } = progressRequest(bookId, currentChunk, frontierChunk);
  return request<ReadingProgress>(url, { method: "PUT", body });
}

// ---------------------------------------------------------------------------
// Highlights + notes
// ---------------------------------------------------------------------------

export function fetchHighlights(
  bookId: string,
): Promise<{ highlights: HighlightDto[] }> {
  return request(`/api/books/${bookId}/highlights`);
}

export function createHighlight(
  bookId: string,
  body: {
    chunkIdx: number;
    text: string;
    color?: string;
    note?: string | null;
  },
): Promise<{ highlight: HighlightDto }> {
  return request(`/api/books/${bookId}/highlights`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateHighlight(
  bookId: string,
  id: string,
  body: { color?: string; note?: string | null },
): Promise<{ highlight: HighlightDto }> {
  return request(`/api/books/${bookId}/highlights/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteHighlight(
  bookId: string,
  id: string,
): Promise<void> {
  await request(`/api/books/${bookId}/highlights/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export function fetchBookmarks(
  bookId: string,
): Promise<{ bookmarks: BookmarkDto[] }> {
  return request(`/api/books/${bookId}/bookmarks`);
}

export function addBookmark(
  bookId: string,
  body: { chunkIdx: number; label?: string | null },
): Promise<{ bookmark: BookmarkDto }> {
  return request(`/api/books/${bookId}/bookmarks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteBookmark(
  bookId: string,
  id: string,
): Promise<void> {
  await request(`/api/books/${bookId}/bookmarks/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Frontier-gated in-book search
// ---------------------------------------------------------------------------

export function searchBook(
  bookId: string,
  q: string,
): Promise<{ results: SearchHit[] }> {
  return request(`/api/books/${bookId}/search?q=${encodeURIComponent(q)}`);
}
