import { NextResponse } from "next/server";

/**
 * Application-level error carrying an HTTP status and a stable machine-
 * readable code. Safe to surface `message` to clients — never use ApiError
 * to wrap unexpected/internal errors with sensitive detail.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Uniform error → NextResponse mapping for API route handlers.
 *
 * Known `ApiError`s are surfaced as-is. Anything else is logged server-side
 * and reported to the client as a generic 500 — never leak internal error
 * text (stack traces, driver messages, etc).
 */
export function handleApiError(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    return NextResponse.json(
      { error: { code: e.code, message: e.message } },
      { status: e.status },
    );
  }

  console.error("[api] unexpected error:", e);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong." } },
    { status: 500 },
  );
}
