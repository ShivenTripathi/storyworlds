import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { getChunk } from "@/services/books";

type Params = { params: Promise<{ bookId: string; idx: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId, idx: idxRaw } = await params;
    const idx = Number(idxRaw);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new ApiError(400, "invalid_request", "Invalid chunk index.");
    }

    const { userId } = await requireUser();
    const book = await requireBookAccess(bookId, userId);

    const chunk = await getChunk(bookId, idx);
    if (!chunk) {
      throw new ApiError(404, "not_found", "Chunk not found.");
    }

    return NextResponse.json(
      {
        idx: chunk.idx,
        pageNumber: chunk.pageNumber,
        text: chunk.text,
        totalChunks: book.totalChunks,
      },
      // Chunk text is immutable per book version, but access is auth-gated
      // (requireBookAccess above), so this must stay `private` — a shared
      // cache must never serve one reader's chunk to another.
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
