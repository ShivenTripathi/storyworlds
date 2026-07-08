import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, chunks, purchases, readingProgress } from "@/db/schema";
import { ApiError } from "@/lib/errors";
import { extractPdf } from "@/services/pdf";
import { storage } from "@/services/storage";

const CHUNK_INSERT_BATCH_SIZE = 100;

export interface CreateBookFromPdfInput {
  ownerId: string;
  title: string;
  author?: string | null;
  data: Uint8Array;
}

/**
 * Stores the source PDF, extracts per-page text, and creates the book +
 * chunk rows. One PDF page = one chunk (0-based idx), including blank
 * pages, so chunk idx and page number stay aligned.
 *
 * If extraction fails, the book row is still created but marked 'failed'.
 */
export async function createBookFromPdf({
  ownerId,
  title,
  author,
  data,
}: CreateBookFromPdfInput) {
  await dbReady;

  const bookId = randomUUID();
  const sourceKey = `books/${bookId}/source.pdf`;
  await storage.put(sourceKey, data, "application/pdf");

  try {
    const { pages, totalWords } = await extractPdf(data);

    const [book] = await db
      .insert(books)
      .values({
        id: bookId,
        ownerId,
        title,
        author: author ?? null,
        sourceKey,
        status: "ready",
        totalChunks: pages.length,
        totalWords,
      })
      .returning();

    for (let i = 0; i < pages.length; i += CHUNK_INSERT_BATCH_SIZE) {
      const batch = pages.slice(i, i + CHUNK_INSERT_BATCH_SIZE).map((page, j) => ({
        bookId,
        idx: i + j,
        pageNumber: page.pageNum,
        wordCount: page.wordCount,
        text: page.text,
      }));
      await db.insert(chunks).values(batch);
    }

    return book;
  } catch (err) {
    console.error(`[books] extraction failed for ${bookId}:`, err);
    const [book] = await db
      .insert(books)
      .values({
        id: bookId,
        ownerId,
        title,
        author: author ?? null,
        sourceKey,
        status: "failed",
      })
      .returning();
    return book;
  }
}

export interface BookDto {
  id: string;
  title: string;
  author: string | null;
  status: string;
  totalChunks: number | null;
  totalWords: number | null;
  createdAt: Date;
  visibility?: string | null;
  themeArchetype?: string | null;
  /** Set by listBooks: whether this book is on the shelf because the caller
   * owns it or because they've added a published book to their library. */
  source?: "owned" | "library";
  progress?: {
    currentChunk: number;
    frontierChunk: number;
    percent: number;
    lastReadAt?: string;
  };
}

/** Maps a book row (+ optional progress row) to the public API DTO shape. */
export function toBookDto(
  book: {
    id: string;
    title: string;
    author: string | null;
    status: string;
    totalChunks: number | null;
    totalWords: number | null;
    createdAt: Date;
    visibility?: string | null;
    themeArchetype?: string | null;
  },
  progress?: {
    currentChunk: number | null;
    frontierChunk: number | null;
    lastReadAt?: Date | null;
  } | null,
  source?: "owned" | "library",
): BookDto {
  const dto: BookDto = {
    id: book.id,
    title: book.title,
    author: book.author,
    status: book.status,
    totalChunks: book.totalChunks,
    totalWords: book.totalWords,
    createdAt: book.createdAt,
    visibility: book.visibility ?? null,
    themeArchetype: book.themeArchetype ?? null,
  };

  if (source) {
    dto.source = source;
  }

  if (progress) {
    const currentChunk = progress.currentChunk ?? 0;
    const frontierChunk = progress.frontierChunk ?? 0;
    const percent =
      book.totalChunks && book.totalChunks > 0
        ? Math.round((currentChunk / book.totalChunks) * 100)
        : 0;
    dto.progress = {
      currentChunk,
      frontierChunk,
      percent,
      lastReadAt: progress.lastReadAt?.toISOString(),
    };
  }

  return dto;
}

export interface BookRow {
  book: typeof books.$inferSelect;
  currentChunk: number | null;
  frontierChunk: number | null;
  lastReadAt: Date | null;
  source: "owned" | "library";
}

/**
 * Books on a reader's shelf: everything they own, unioned with published
 * books they've added to their library (via `addToLibrary`). Deduplicated
 * by book id — owned always wins the `source` flag if somehow both apply.
 */
export async function listBooks(ownerId: string): Promise<BookRow[]> {
  await dbReady;

  const progressJoin = and(
    eq(readingProgress.bookId, books.id),
    eq(readingProgress.userId, ownerId),
  );

  const ownedRows = await db
    .select({
      book: books,
      currentChunk: readingProgress.currentChunk,
      frontierChunk: readingProgress.frontierChunk,
      lastReadAt: readingProgress.updatedAt,
    })
    .from(books)
    .where(eq(books.ownerId, ownerId))
    .leftJoin(readingProgress, progressJoin);

  const libraryRows = await db
    .select({
      book: books,
      currentChunk: readingProgress.currentChunk,
      frontierChunk: readingProgress.frontierChunk,
      lastReadAt: readingProgress.updatedAt,
    })
    .from(purchases)
    .innerJoin(books, eq(books.id, purchases.bookId))
    .leftJoin(readingProgress, progressJoin)
    .where(eq(purchases.userId, ownerId));

  const byId = new Map<string, BookRow>();
  for (const r of ownedRows) {
    byId.set(r.book.id, { ...r, source: "owned" });
  }
  for (const r of libraryRows) {
    if (!byId.has(r.book.id)) {
      byId.set(r.book.id, { ...r, source: "library" });
    }
  }

  return Array.from(byId.values());
}

/** Overrides a book's theme archetype. Admin-gated by the caller. */
export async function setThemeArchetype(bookId: string, archetype: string) {
  await dbReady;
  const [book] = await db
    .update(books)
    .set({ themeArchetype: archetype, updatedAt: new Date() })
    .where(eq(books.id, bookId))
    .returning();
  return book;
}

/** Flips a book's marketplace visibility. Admin-gated by the caller. */
export async function setVisibility(
  bookId: string,
  visibility: "published" | "private",
) {
  await dbReady;
  const [book] = await db
    .update(books)
    .set({ visibility, updatedAt: new Date() })
    .where(eq(books.id, bookId))
    .returning();
  return book;
}

/** All published books, newest first. No owner emails — title/author only. */
export async function listPublished() {
  await dbReady;
  return db
    .select()
    .from(books)
    .where(eq(books.visibility, "published"))
    .orderBy(desc(books.createdAt));
}

/**
 * Adds a published book to a reader's library (free — the shared analysis
 * means there's nothing new to compute). Idempotent. Throws 404/403 if the
 * book doesn't exist or isn't published.
 */
export async function addToLibrary(userId: string, bookId: string) {
  await dbReady;

  const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  if (!book) {
    throw new ApiError(404, "not_found", "Book not found.");
  }
  if (book.visibility !== "published") {
    throw new ApiError(403, "forbidden", "This book isn't published.");
  }

  await db
    .insert(purchases)
    .values({ userId, bookId, amountCents: 0, status: "free" })
    .onConflictDoNothing({ target: [purchases.userId, purchases.bookId] });

  return book;
}

export async function getBook(bookId: string) {
  await dbReady;
  const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  return book;
}

export async function getProgress(userId: string, bookId: string) {
  await dbReady;
  const [row] = await db
    .select()
    .from(readingProgress)
    .where(
      and(eq(readingProgress.userId, userId), eq(readingProgress.bookId, bookId)),
    )
    .limit(1);
  return row;
}

export async function deleteBook(bookId: string) {
  await dbReady;
  await db.delete(books).where(eq(books.id, bookId)); // cascades to children
  await storage.deletePrefix(`books/${bookId}/`);
}

export async function getChunk(bookId: string, idx: number) {
  await dbReady;
  const [chunk] = await db
    .select()
    .from(chunks)
    .where(and(eq(chunks.bookId, bookId), eq(chunks.idx, idx)))
    .limit(1);
  return chunk;
}

/**
 * Upserts reading progress for a user/book, always keeping frontierChunk as
 * the max of its current value and the new currentChunk (spoiler gate never
 * moves backward).
 */
export async function updateProgress(
  userId: string,
  bookId: string,
  currentChunk: number,
) {
  await dbReady;

  const [row] = await db
    .insert(readingProgress)
    .values({ userId, bookId, currentChunk, frontierChunk: currentChunk })
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.bookId],
      set: {
        currentChunk,
        frontierChunk: sql`greatest(${readingProgress.frontierChunk}, ${currentChunk})`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return row;
}
