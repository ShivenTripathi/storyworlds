import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { searchBook } from "@/services/annotations";
import { getProgress } from "@/services/books";

type Params = { params: Promise<{ bookId: string }> };

const MAX_QUERY_CHARS = 200;

/**
 * GET /api/books/:bookId/search?q=...
 *
 * In-book full-text search, gated to the reader's spoiler frontier by
 * default (SPOILER-FRONTIER is a hard invariant — see CLAUDE.md): only
 * chunks the caller has already reached (`frontierChunk`) are searched, so a
 * query can never surface text from further ahead than the reader has read.
 *
 * Mirrors `GET /api/books/:bookId/world`'s `?full=1` convention: the book's
 * owner or an admin may opt into an unfiltered search of the whole book, but
 * a reader can never lift their own gate via a query param.
 */
export async function GET(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId, role } = await requireUser();
    rateLimit(`user:${userId}:book-search`, { windowSeconds: 60, max: 30 });
    const book = await requireBookAccess(bookId, userId);

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) {
      return NextResponse.json({ results: [] });
    }
    if (q.length > MAX_QUERY_CHARS) {
      throw new ApiError(400, "invalid_request", "Search query is too long.");
    }

    const wantsFull = url.searchParams.get("full") === "1";
    const privileged = role === "admin" || book.ownerId === userId;
    const useFrontier = !(wantsFull && privileged);

    let frontierChunk = 0;
    if (useFrontier) {
      const progress = await getProgress(userId, bookId);
      frontierChunk = progress?.frontierChunk ?? 0;
    }

    const results = await searchBook({ bookId, q, useFrontier, frontierChunk });
    return NextResponse.json({ results });
  } catch (e) {
    return handleApiError(e);
  }
}
