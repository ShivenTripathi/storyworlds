import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { ApiError, handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { deleteBook, getBook } from "@/services/books";

type Params = { params: Promise<{ bookId: string }> };

/**
 * Admin hard-delete of ANY book (owned by anyone) — distinct from the
 * owner/library DELETE at /api/books/[bookId], which only detaches a
 * non-owner's shelf entry. Cascades away the book's chunks, world, entities,
 * overlays, images, progress, chat, annotations, and stored files.
 */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { userId } = await requireAdmin();
    rateLimit(`admin:${userId}:delete-book`, { windowSeconds: 60, max: 30 });
    const { bookId } = await params;

    const book = await getBook(bookId);
    if (!book) {
      throw new ApiError(404, "not_found", "Book not found.");
    }

    await deleteBook(bookId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
}
