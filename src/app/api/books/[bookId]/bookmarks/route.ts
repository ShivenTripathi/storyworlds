import { NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { addBookmark, listBookmarks } from "@/services/annotations";

type Params = { params: Promise<{ bookId: string }> };

const createSchema = z.object({
  chunkIdx: z.number().int().min(0),
  label: z.string().trim().max(200).nullable().optional(),
});

/** GET /api/books/:bookId/bookmarks — the caller's own bookmarks, never another reader's. */
export async function GET(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId } = await requireUser();
    await requireBookAccess(bookId, userId);

    const result = await listBookmarks(userId, bookId);
    return NextResponse.json({ bookmarks: result });
  } catch (e) {
    return handleApiError(e);
  }
}

/**
 * POST /api/books/:bookId/bookmarks — saves the current page as a bookmark.
 * Upserts on (user, book, chunk): bookmarking an already-bookmarked page
 * just updates its label rather than erroring.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId } = await requireUser();
    rateLimit(`user:${userId}:annotate`, { windowSeconds: 60, max: 60 });
    const book = await requireBookAccess(bookId, userId);

    const json = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        "Invalid body: expected { chunkIdx: number, label?: string | null }.",
      );
    }

    const maxChunk = Math.max(0, (book.totalChunks ?? 1) - 1);
    const chunkIdx = Math.min(Math.max(0, parsed.data.chunkIdx), maxChunk);

    const bookmark = await addBookmark({
      userId,
      bookId,
      chunkIdx,
      label: parsed.data.label ?? null,
    });
    return NextResponse.json({ bookmark }, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
