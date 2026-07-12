import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { addToLibrary, toBookDto } from "@/services/books";

type Params = { params: Promise<{ bookId: string }> };

/** Adds a published book to the caller's library. Free — the analysis is shared. */
export async function POST(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { userId } = await requireUser();
    rateLimit(`user:${userId}:marketplace-add`, { windowSeconds: 60, max: 30 });
    const { bookId } = await params;

    const book = await addToLibrary(userId, bookId);

    return NextResponse.json(
      { book: await toBookDto(book, null, "library") },
      { status: 201 },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
