import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import {
  deleteBook,
  getProgress,
  removeFromLibrary,
  toBookDto,
} from "@/services/books";

type Params = { params: Promise<{ bookId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId } = await requireUser();
    const book = await requireBookAccess(bookId, userId);

    const progressRow = await getProgress(userId, bookId);
    const progress = {
      currentChunk: progressRow?.currentChunk ?? 0,
      frontierChunk: progressRow?.frontierChunk ?? 0,
    };

    return NextResponse.json({ book: await toBookDto(book), progress });
  } catch (e) {
    return handleApiError(e);
  }
}

/**
 * "Remove from shelf" — behavior depends on HOW the book got onto the
 * caller's shelf (see BookRow.source in src/services/books.ts):
 *  - owned (they uploaded it): permanently deletes the book for everyone
 *    (`deleteBook`) — it's theirs, nobody else's shelf entry depends on it
 *    unless someone else separately added it to their library.
 *  - library (added a published book from Discover): only detaches THEIR
 *    library entry (`removeFromLibrary`) — the shared book, its analysis,
 *    and every other reader's copy must be untouched.
 * Previously this always called `deleteBook` behind a write-access check,
 * which 403'd outright for library-sourced books (no write access to a book
 * you don't own) — "remove from shelf" silently never worked for anything
 * added from Discover.
 */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId } = await requireUser();
    const book = await requireBookAccess(bookId, userId);

    if (book.ownerId === userId) {
      await deleteBook(bookId);
    } else {
      const removed = await removeFromLibrary(userId, bookId);
      if (!removed) {
        throw new ApiError(404, "not_found", "That book isn't on your shelf.");
      }
    }

    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
}
