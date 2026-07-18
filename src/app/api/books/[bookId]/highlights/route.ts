import { NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { isHighlightColor } from "@/domain/highlights";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { createHighlight, listHighlights } from "@/services/annotations";

type Params = { params: Promise<{ bookId: string }> };

const createSchema = z.object({
  chunkIdx: z.number().int().min(0),
  text: z.string().trim().min(1).max(4000),
  color: z.string().trim().min(1).max(20).optional(),
  note: z.string().trim().max(4000).nullable().optional(),
});

/** GET /api/books/:bookId/highlights — the caller's own highlights (+ notes), never another reader's. */
export async function GET(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId } = await requireUser();
    await requireBookAccess(bookId, userId);

    const result = await listHighlights(userId, bookId);
    return NextResponse.json({ highlights: result });
  } catch (e) {
    return handleApiError(e);
  }
}

/** POST /api/books/:bookId/highlights — creates a highlight, optionally with a note. */
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
        "Invalid body: expected { chunkIdx: number, text: string, color?: string, note?: string }.",
      );
    }
    if (parsed.data.color && !isHighlightColor(parsed.data.color)) {
      throw new ApiError(
        400,
        "invalid_request",
        "Unsupported highlight color.",
      );
    }

    // Clamp to the book's real length, same defensive pattern as
    // updateProgress — a highlight can't reference a chunk that doesn't exist.
    const maxChunk = Math.max(0, (book.totalChunks ?? 1) - 1);
    const chunkIdx = Math.min(Math.max(0, parsed.data.chunkIdx), maxChunk);

    const highlight = await createHighlight({
      userId,
      bookId,
      chunkIdx,
      text: parsed.data.text,
      color: parsed.data.color,
      note: parsed.data.note ?? null,
    });
    return NextResponse.json({ highlight }, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
