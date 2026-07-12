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
      const batch = pages
        .slice(i, i + CHUNK_INSERT_BATCH_SIZE)
        .map((page, j) => ({
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

const CHUNK_TARGET_CHARS = 1800;
const CHUNK_HARD_MAX_CHARS = 3000;

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Hard-wraps a single oversized paragraph on whitespace boundaries near `maxChars`. */
function hardWrapParagraph(paragraph: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > maxChars) {
    let splitAt = rest.lastIndexOf(" ", maxChars);
    if (splitAt <= 0) splitAt = maxChars;
    pieces.push(rest.slice(0, splitAt).trim());
    rest = rest.slice(splitAt).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * Splits plain text into page-sized chunks on paragraph (blank-line)
 * boundaries, greedily packing paragraphs up to ~CHUNK_TARGET_CHARS. A
 * paragraph is never split unless it alone exceeds CHUNK_HARD_MAX_CHARS, in
 * which case it's hard-wrapped on whitespace.
 */
export function chunkPlainText(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const pages: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) return;
    pages.push(current.join("\n\n"));
    current = [];
    currentLength = 0;
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_HARD_MAX_CHARS) {
      flush();
      for (const piece of hardWrapParagraph(paragraph, CHUNK_HARD_MAX_CHARS)) {
        pages.push(piece);
      }
      continue;
    }

    if (
      current.length > 0 &&
      currentLength + paragraph.length > CHUNK_TARGET_CHARS
    ) {
      flush();
    }

    current.push(paragraph);
    currentLength += paragraph.length;
  }

  flush();

  return pages;
}

export interface CreateBookFromTextInput {
  ownerId: string;
  title: string;
  author?: string | null;
  text: string;
  catalogSource: string;
  blurb?: string | null;
  archetype?: string;
  visibility?: "private" | "published";
}

/**
 * Creates a book (+ chunk rows) from plain text with no source PDF — used by
 * the Gutenberg catalog ingestion pipeline (src/services/catalog.ts). Unlike
 * createBookFromPdf there's no storage/extraction step: the text is chunked
 * directly into page-sized units.
 *
 * Idempotent on `catalogSource`: if a book with this catalogSource already
 * exists, it's returned as-is without re-creating or re-chunking.
 */
export async function createBookFromText({
  ownerId,
  title,
  author,
  text,
  catalogSource,
  blurb,
  archetype,
  visibility = "private",
}: CreateBookFromTextInput) {
  await dbReady;

  const [existing] = await db
    .select()
    .from(books)
    .where(eq(books.catalogSource, catalogSource))
    .limit(1);
  if (existing) {
    return existing;
  }

  const pages = chunkPlainText(text);
  const totalWords = pages.reduce((sum, p) => sum + countWords(p), 0);

  const [book] = await db
    .insert(books)
    .values({
      ownerId,
      title,
      author: author ?? null,
      status: "ready",
      totalChunks: pages.length,
      totalWords,
      visibility,
      themeArchetype: archetype ?? undefined,
      catalogSource,
      blurb: blurb ?? null,
    })
    .returning();

  for (let i = 0; i < pages.length; i += CHUNK_INSERT_BATCH_SIZE) {
    const batch = pages
      .slice(i, i + CHUNK_INSERT_BATCH_SIZE)
      .map((pageText, j) => ({
        bookId: book.id,
        idx: i + j,
        pageNumber: i + j + 1,
        wordCount: countWords(pageText),
        text: pageText,
      }));
    await db.insert(chunks).values(batch);
  }

  return book;
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

  const [book] = await db
    .select()
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
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
  const [book] = await db
    .select()
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  return book;
}

export async function getProgress(userId: string, bookId: string) {
  await dbReady;
  const [row] = await db
    .select()
    .from(readingProgress)
    .where(
      and(
        eq(readingProgress.userId, userId),
        eq(readingProgress.bookId, bookId),
      ),
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

  // Clamp to the book's real length: an unbounded client-supplied position
  // could otherwise push the spoiler frontier to "finished" and unlock every
  // reveal. frontierChunk is derived from this clamped value, never trusted raw.
  const [bookRow] = await db
    .select({ totalChunks: books.totalChunks })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  const maxChunk = Math.max(0, (bookRow?.totalChunks ?? 1) - 1);
  currentChunk = Math.min(Math.max(0, currentChunk), maxChunk);

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
