import type { ApiErrorBody, JobResponse, WorldResponse } from "./types";

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
