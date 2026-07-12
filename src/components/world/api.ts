import type {
  ApiErrorBody,
  JobResponse,
  OverlayResponse,
  WorldEntity,
  WorldResponse,
} from "./types";

/**
 * Single-entity dossier lookup contract
 * (GET /api/books/{id}/world/entities/{entityId}). `entity` is null when the
 * world isn't analyzed yet or no entity matches the id.
 */
export interface WorldEntityResponse {
  entity: WorldEntity | null;
  themeArchetype: string | null;
}

/**
 * Thin fetch wrapper for the "world" API contract. All routes are
 * same-origin and cookie-authed (Clerk) — no auth headers needed.
 */
export class WorldApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "WorldApiError";
    this.status = status;
    this.code = code;
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
    let code: string | undefined;
    try {
      const data = (await res.json()) as ApiErrorBody | null;
      if (data?.error?.message) message = data.error.message;
      code = data?.error?.code;
    } catch {
      // response body wasn't JSON — fall back to statusText
    }
    throw new WorldApiError(res.status, message, code);
  }

  return (await res.json()) as T;
}

export function fetchWorld(bookId: string): Promise<WorldResponse> {
  return request<WorldResponse>(`/api/books/${bookId}/world`);
}

/**
 * Fetches a single entity's dossier by id. Resolves the entity regardless of
 * the reader's frontier (so a "Dossier →" link never dead-ends), with
 * inner-life attributes still spoiler-gated server-side. Entity ids contain a
 * colon (`char:sherlock-holmes`); we encode the id so it survives as one path
 * segment.
 */
export function fetchWorldEntity(
  bookId: string,
  entityId: string,
): Promise<WorldEntityResponse> {
  return request<WorldEntityResponse>(
    `/api/books/${bookId}/world/entities/${encodeURIComponent(entityId)}`,
  );
}

/**
 * Kicks off (or resumes) analysis for a book. A 409 `already_analyzed`
 * response is not an error from the caller's perspective — the world
 * already exists, so callers should treat it as "go refetch the world".
 */
export async function analyzeBook(bookId: string): Promise<JobResponse | null> {
  try {
    return await request<JobResponse>(`/api/books/${bookId}/analyze`, {
      method: "POST",
    });
  } catch (err) {
    if (err instanceof WorldApiError && err.code === "already_analyzed") {
      return null;
    }
    throw err;
  }
}

export function fetchJob(jobId: string): Promise<JobResponse> {
  return request<JobResponse>(`/api/jobs/${jobId}`);
}

/**
 * Fetches a single page's scene overlay. The server responds
 * `{pending: true}` while generation is in flight (poll again) or
 * `{overlay: {...}}` once ready. A 404/409 (or `world_not_ready` code)
 * means the book's world isn't in a state to have overlays yet — callers
 * should treat that as terminal, not retry.
 */
export function fetchOverlay(
  bookId: string,
  chunkIdx: number,
): Promise<OverlayResponse> {
  return request<OverlayResponse>(`/api/books/${bookId}/overlays/${chunkIdx}`);
}
