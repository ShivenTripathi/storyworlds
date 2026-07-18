// Shared types for the character chat surface. Mirrors the API contract for
// POST /api/books/{id}/chat and GET /api/books/{id}/chat/{entityId}/history.

export type ChatMode = "story_so_far" | "after_ending";

type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface ChatHistoryResponse {
  messages: ChatMessage[];
}

export class ChatSpoilerGateError extends Error {
  constructor() {
    super("Spoiler acknowledgement required");
    this.name = "ChatSpoilerGateError";
  }
}

/**
 * A non-2xx chat response the server explained with a `{ error: { code,
 * message } }` body — covers the daily-quota "at_capacity" (503) case and
 * "rate_limited"/"limit_reached" (429) cases from src/services/chat.ts,
 * src/lib/rate-limit.ts, and src/services/entitlements.ts. Callers can
 * branch on `status`/`code` to show the server's specific, friendly
 * `message` instead of a generic failure bubble.
 */
export class ChatApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
    this.code = code;
  }
}

/** True for responses signalling temporary unavailability (daily quota
 * exhausted, rate limit hit) rather than a hard failure — worth surfacing
 * distinctly since "try again shortly/tomorrow" is actionable advice. */
export function isCapacityError(err: unknown): err is ChatApiError {
  return (
    err instanceof ChatApiError && (err.status === 503 || err.status === 429)
  );
}

export interface SendChatOptions {
  entityId: string;
  mode: ChatMode;
  message: string;
  chunkIdx: number;
  acknowledgeSpoilers?: boolean;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}

/**
 * Fetches this mode's chat history for a character.
 */
export async function fetchChatHistory(
  bookId: string,
  entityId: string,
  mode: ChatMode,
): Promise<ChatHistoryResponse> {
  const res = await fetch(
    `/api/books/${bookId}/chat/${entityId}/history?mode=${mode}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) throw new Error(`Failed to load chat history (${res.status})`);
  return (await res.json()) as ChatHistoryResponse;
}

/**
 * Sends a chat message and streams the reply via SSE-over-fetch (the POST
 * body rules out EventSource, so the response body's ReadableStream is
 * parsed manually for `data: ` lines).
 *
 * Throws `ChatSpoilerGateError` on a 403 `spoiler_gate` response — callers
 * should show the press-and-hold confirmation and retry with
 * `acknowledgeSpoilers: true`.
 */
export async function sendChatMessage(
  bookId: string,
  {
    entityId,
    mode,
    message,
    chunkIdx,
    acknowledgeSpoilers,
    signal,
    onDelta,
  }: SendChatOptions,
): Promise<void> {
  const res = await fetch(`/api/books/${bookId}/chat`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entityId,
      mode,
      message,
      chunkIdx,
      acknowledgeSpoilers,
    }),
    signal,
  });

  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (body?.error?.code === "spoiler_gate") {
      throw new ChatSpoilerGateError();
    }
    throw new ChatApiError(
      403,
      body?.error?.code,
      body?.error?.message ?? "This conversation couldn't continue.",
    );
  }

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ChatApiError(
      res.status,
      body?.error?.code,
      body?.error?.message ?? `Chat request failed (${res.status}).`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (!payload) continue;
      let parsed: { delta?: string; done?: boolean; error?: string };
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.delta) onDelta(parsed.delta);
      if (parsed.done) return;
    }
  }
}
