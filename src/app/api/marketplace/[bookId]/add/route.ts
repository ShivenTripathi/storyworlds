import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { addToLibrary, toBookDto } from "@/services/books";

type Params = { params: Promise<{ bookId: string }> };

/** Adds a published book to the caller's library. Free — the analysis is shared. */
export async function POST(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { userId } = await requireUser();
    const { bookId } = await params;

    const book = await addToLibrary(userId, bookId);

    return NextResponse.json({ book: toBookDto(book, null, "library") }, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
