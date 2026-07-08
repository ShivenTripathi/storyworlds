import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { ApiError, handleApiError } from "@/lib/errors";
import { setVisibility, toBookDto } from "@/services/books";

type Params = { params: Promise<{ bookId: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    await dbReady;
    await requireAdmin();
    const { bookId } = await params;

    const book = await setVisibility(bookId, "published");
    if (!book) {
      throw new ApiError(404, "not_found", "Book not found.");
    }

    return NextResponse.json({ book: toBookDto(book) });
  } catch (e) {
    return handleApiError(e);
  }
}
