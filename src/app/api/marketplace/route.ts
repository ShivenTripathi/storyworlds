import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { listBooks, listPublished, toBookDto } from "@/services/books";

/**
 * The Discover feed: published books, flagged with `source: 'library'`
 * if the caller has already added them to their shelf. Requires sign-in
 * (not truly public) but is not owner/admin gated — any signed-in reader
 * can browse and add published books.
 *
 * Supports `?q=` (case-insensitive title/author search, ILIKE server-side —
 * the catalog is unbounded so filtering has to happen in the DB, not after
 * loading everything) and `?limit=`/`?offset=` pagination (the catalog grows
 * via self-draining ingestion, so this never returns the whole thing at
 * once; the client pages with a "Load more" button).
 */
export async function GET(req: Request) {
  try {
    await dbReady;
    const { userId } = await requireUser();

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || undefined;
    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");
    const limit = limitParam ? Number(limitParam) : undefined;
    const offset = offsetParam ? Number(offsetParam) : undefined;

    const [{ books: published, hasMore }, mine] = await Promise.all([
      listPublished({
        q,
        limit: Number.isFinite(limit) ? limit : undefined,
        offset: Number.isFinite(offset) ? offset : undefined,
      }),
      listBooks(userId),
    ]);
    const inLibrary = new Set(mine.map((r) => r.book.id));

    const books = await Promise.all(
      published.map((book) =>
        toBookDto(book, null, inLibrary.has(book.id) ? "library" : undefined),
      ),
    );

    return NextResponse.json({ books, hasMore });
  } catch (e) {
    return handleApiError(e);
  }
}
