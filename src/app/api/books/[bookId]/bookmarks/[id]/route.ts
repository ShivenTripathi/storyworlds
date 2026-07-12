import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { removeBookmark } from "@/services/annotations";

type Params = { params: Promise<{ bookId: string; id: string }> };

/** DELETE /api/books/:bookId/bookmarks/:id — removes one of the caller's own bookmarks. */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId, id } = await params;
    const { userId } = await requireUser();
    await requireBookAccess(bookId, userId);

    await removeBookmark(userId, id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
}
