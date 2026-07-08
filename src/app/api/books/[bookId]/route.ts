import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { deleteBook, getProgress, toBookDto } from "@/services/books";

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

    return NextResponse.json({ book: toBookDto(book), progress });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId } = await requireUser();
    await requireBookAccess(bookId, userId, { write: true });

    await deleteBook(bookId);

    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
}
