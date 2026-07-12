import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { listBooks, listPublished, toBookDto } from "@/services/books";

/**
 * The Discover feed: every published book, flagged with `source: 'library'`
 * if the caller has already added it to their shelf. Requires sign-in
 * (not truly public) but is not owner/admin gated — any signed-in reader
 * can browse and add published books.
 */
export async function GET() {
  try {
    await dbReady;
    const { userId } = await requireUser();

    const [published, mine] = await Promise.all([
      listPublished(),
      listBooks(userId),
    ]);
    const inLibrary = new Set(mine.map((r) => r.book.id));

    const books = await Promise.all(
      published.map((book) =>
        toBookDto(book, null, inLibrary.has(book.id) ? "library" : undefined),
      ),
    );

    return NextResponse.json({ books });
  } catch (e) {
    return handleApiError(e);
  }
}
