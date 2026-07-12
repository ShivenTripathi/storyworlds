import type { BookResponse, ChunkPayload, ReadingProgress } from "./types";

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
