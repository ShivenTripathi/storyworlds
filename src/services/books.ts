import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, chunks, purchases, readingProgress } from "@/db/schema";
import { ApiError } from "@/lib/errors";
import {
  ACCEPTED_UPLOAD_EXTENSIONS,
  chunkPlainText,
  countWords,
  decodeTextFile,
  detectBookFormat,
  MAX_CHUNKS,
  titleFromFilename,
  type BookSourceFormat,
} from "@/domain/book-format";
import { extractEpubText } from "@/services/epub";
import { extractPdf, type PdfPage } from "@/services/pdf";
import { storage } from "@/services/storage";

const CHUNK_INSERT_BATCH_SIZE = 100;

// Format detection + text chunking are pure and now live in the domain layer
// (src/domain/book-format.ts) so the browser can run them too — the upload
// UI extracts client-side and posts already-extracted text, sidestepping
// Vercel's 4.5MB serverless request-body limit. Re-exported here for the
// server-side callers (upload route, catalog ingestion) that already import
// them from this module.
export { ACCEPTED_UPLOAD_EXTENSIONS, detectBookFormat, type BookSourceFormat };

/**
 * Visibility/monetization model (see CLAUDE.md "THE MODEL"):
 *  - 'public_subsidized': uploader waived rights (rightsAttestation set),
 *    visibility='published', analysis shared across all readers, cheap.
 *  - 'private_premium': visibility='private', analysis not shared (single
 *    reader), so its cost isn't amortizable — premium priced.
 *  - 'catalog': auto-ingested Gutenberg seed books (also shared/free, but
 *    distinct from user contributions for admin reporting).
 */
export type PricingTier = "public_subsidized" | "private_premium" | "catalog";

export type RightsAttestation = "public_domain" | "owned_contributed";

export interface CreateBookFromUploadInput {
  ownerId: string;
  /** Original uploaded filename — drives format detection + default title. */
  filename: string;
  data: Uint8Array;
  /** User-supplied title; falls back to EPUB metadata, then the filename. */
  title?: string | null;
  /** User-supplied author; falls back to EPUB metadata (dc:creator). */
  author?: string | null;
  /** Defaults to 'private' / 'private_premium' — see PricingTier above. */
  visibility?: "private" | "published";
  pricingTier?: PricingTier;
  rightsAttestation?: RightsAttestation | null;
  /** Set when visibility='published': who contributed it to the public library. */
  contributedByUserId?: string | null;
}

const SOURCE_CONTENT_TYPE: Record<BookSourceFormat, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  txt: "text/plain; charset=utf-8",
};

/**
 * Unified book-creation entry point: detects the upload's format (pdf /
 * epub / txt), extracts it to page-sized chunks, stores the original source
 * blob, and creates the book + chunk rows. Format is a detail of extraction,
 * not a parallel code path — PDF pages become chunks 1:1 (via
 * src/services/pdf.ts), while EPUB (src/services/epub.ts) and plain text
 * are concatenated/normalized to plain text and split with
 * `chunkPlainText`.
 *
 * Throws `ApiError(400)` up-front for an unrecognized/spoofed file (caller
 * should validate before this in the common case, but this is the single
 * source of truth for "is this file supported"). If extraction of an
 * otherwise-valid file fails, the book row is still created but marked
 * 'failed' — mirroring the previous PDF-only behavior.
 */
export async function createBookFromUpload({
  ownerId,
  filename,
  data,
  title,
  author,
  visibility = "private",
  pricingTier = visibility === "published"
    ? "public_subsidized"
    : "private_premium",
  rightsAttestation = null,
  contributedByUserId = null,
}: CreateBookFromUploadInput) {
  await dbReady;

  const format = detectBookFormat(filename, data);
  if (!format) {
    throw new ApiError(
      400,
      "invalid_request",
      "Unsupported or unrecognized file — upload a PDF, EPUB, or plain-text (.txt) file.",
    );
  }

  const bookId = randomUUID();
  const sourceKey = `books/${bookId}/source.${format}`;
  await storage.put(sourceKey, data, SOURCE_CONTENT_TYPE[format]);

  let resolvedTitle = title?.trim() || null;
  let resolvedAuthor = author?.trim() || null;

  const baseRow = {
    id: bookId,
    ownerId,
    sourceKey,
    sourceFormat: format,
    visibility,
    pricingTier,
    rightsAttestation,
    contributedByUserId,
  };

  try {
    let pages: PdfPage[];
    let totalWords: number;

    if (format === "pdf") {
      const extracted = await extractPdf(data);
      pages = extracted.pages;
      totalWords = extracted.totalWords;
    } else {
      let text: string;
      if (format === "epub") {
        const extracted = await extractEpubText(data);
        text = extracted.text;
        resolvedTitle = resolvedTitle ?? extracted.title;
        resolvedAuthor = resolvedAuthor ?? extracted.author;
      } else {
        text = decodeTextFile(data);
      }
      const plainPages = chunkPlainText(text);
      pages = plainPages.map((pageText, i) => ({
        pageNum: i + 1,
        text: pageText,
        wordCount: countWords(pageText),
      }));
      totalWords = pages.reduce((sum, p) => sum + p.wordCount, 0);
    }

    resolvedTitle = resolvedTitle ?? titleFromFilename(filename) ?? "Untitled";

    const [book] = await db
      .insert(books)
      .values({
        ...baseRow,
        title: resolvedTitle,
        author: resolvedAuthor,
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
    console.error(`[books] extraction failed for ${bookId} (${format}):`, err);
    const [book] = await db
      .insert(books)
      .values({
        ...baseRow,
        title: resolvedTitle ?? titleFromFilename(filename) ?? "Untitled",
        author: resolvedAuthor,
        status: "failed",
      })
      .returning();
    return book;
  }
}

/** A single extracted page as posted by the client-side extractor. */
export interface ExtractedPage {
  pageNum: number;
  text: string;
}

export interface CreateBookFromExtractedInput {
  ownerId: string;
  /** Detected + client-extracted; the server re-validates count/size, not bytes. */
  sourceFormat: BookSourceFormat;
  title?: string | null;
  author?: string | null;
  /** Already-extracted, page-sized text. Extraction ran in the browser to
   * keep the request body under Vercel's 4.5MB serverless limit. */
  pages: ExtractedPage[];
  visibility?: "private" | "published";
  pricingTier?: PricingTier;
  rightsAttestation?: RightsAttestation | null;
  contributedByUserId?: string | null;
}

/** Per-page text ceiling — a generous multiple of the chunker's hard max;
 * guards against a client posting a few enormous pages to blow up storage. */
const MAX_PAGE_CHARS = 20_000;

/**
 * Creates a book (+ chunk rows) from text the CLIENT already extracted, with
 * no server-side PDF/EPUB parsing and no stored source blob. This is the
 * primary upload path: the browser extracts a PDF/EPUB/TXT to page-sized
 * text and posts it as a small JSON body, which sidesteps Vercel's 4.5MB
 * serverless request-body limit (a large PDF's text is a fraction of the
 * source file) and offloads extraction CPU from the timeout-bound function.
 *
 * The posted text is untrusted input treated exactly like catalog text — it
 * only ever becomes chunk rows, never executed — so the server re-validates
 * shape (non-empty, chunk count ≤ MAX_CHUNKS, per-page size) and re-derives
 * word counts rather than trusting client-supplied numbers.
 */
export async function createBookFromExtracted({
  ownerId,
  sourceFormat,
  title,
  author,
  pages: rawPages,
  visibility = "private",
  pricingTier = visibility === "published"
    ? "public_subsidized"
    : "private_premium",
  rightsAttestation = null,
  contributedByUserId = null,
}: CreateBookFromExtractedInput) {
  await dbReady;

  const pages = rawPages
    .map((p) => ({ pageNum: p.pageNum, text: (p.text ?? "").trim() }))
    .filter((p) => p.text.length > 0);

  if (pages.length === 0) {
    throw new ApiError(
      400,
      "invalid_request",
      "We couldn't read any text from that file. If it's a scanned PDF (images only), it has no selectable text to extract.",
    );
  }
  if (pages.length > MAX_CHUNKS) {
    throw new ApiError(
      400,
      "invalid_request",
      `That book is too long to bind (${pages.length} pages; the limit is ${MAX_CHUNKS}).`,
    );
  }
  if (pages.some((p) => p.text.length > MAX_PAGE_CHARS)) {
    throw new ApiError(
      400,
      "invalid_request",
      "That file's pages are unexpectedly large — it may not have extracted cleanly. Try a different export.",
    );
  }

  const withCounts = pages.map((p, i) => ({
    pageNum: i + 1,
    text: p.text,
    wordCount: countWords(p.text),
  }));
  const totalWords = withCounts.reduce((sum, p) => sum + p.wordCount, 0);

  const [book] = await db
    .insert(books)
    .values({
      ownerId,
      sourceFormat,
      title: title?.trim() || "Untitled",
      author: author?.trim() || null,
      status: "ready",
      totalChunks: withCounts.length,
      totalWords,
      visibility,
      pricingTier,
      rightsAttestation,
      contributedByUserId,
    })
    .returning();

  for (let i = 0; i < withCounts.length; i += CHUNK_INSERT_BATCH_SIZE) {
    const batch = withCounts
      .slice(i, i + CHUNK_INSERT_BATCH_SIZE)
      .map((page, j) => ({
        bookId: book.id,
        idx: i + j,
        pageNumber: page.pageNum,
        wordCount: page.wordCount,
        text: page.text,
      }));
    await db.insert(chunks).values(batch);
  }

  return book;
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
  /** Defaults to 'catalog' — auto-ingested Gutenberg seed books are shared/free. */
  pricingTier?: PricingTier;
  rightsAttestation?: RightsAttestation | null;
}

/**
 * Creates a book (+ chunk rows) from plain text with no stored source file —
 * used by the Gutenberg catalog ingestion pipeline (src/services/catalog.ts).
 * Unlike createBookFromUpload there's no storage/extraction step: the text
 * is chunked directly into page-sized units.
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
  pricingTier = "catalog",
  rightsAttestation = "public_domain",
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
      pricingTier,
      rightsAttestation,
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
  /** 'public_subsidized' | 'private_premium' | 'catalog' | null (legacy rows) — see PricingTier. */
  pricingTier?: string | null;
  /** 'pdf' | 'epub' | 'txt' | null (catalog books / legacy rows with no stored source). */
  sourceFormat?: string | null;
  /** Spoiler-free back-cover teaser — null until analysis has produced one
   * (see WorldSynthesisSchema.blurb / src/jobs/analyze-book.ts persistWorld).
   * Shown on Discover and the book-detail page, always BEFORE reading. */
  blurb?: string | null;
  /** Resolved URL for the generated cover illustration (see
   * src/services/cover.ts + books.coverStorageKey), or null until one has
   * been generated. Render the typographic fallback cover
   * (src/components/shelf/TypographicCover.tsx) while null. */
  coverUrl?: string | null;
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

/**
 * Maps a book row (+ optional progress row) to the public API DTO shape.
 * Async only because it resolves `coverUrl` via the storage driver
 * (src/services/storage.ts) — for the zero-cost DB/local drivers that's a
 * cheap in-process string synthesis (no I/O), and even R2's signed URL is a
 * local presign computation, so this stays "a single cheap read, no N+1"
 * regardless of driver. Callers mapping over an array should batch with
 * `Promise.all` rather than awaiting in a loop.
 */
export async function toBookDto(
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
    pricingTier?: string | null;
    sourceFormat?: string | null;
    blurb?: string | null;
    coverStorageKey?: string | null;
  },
  progress?: {
    currentChunk: number | null;
    frontierChunk: number | null;
    lastReadAt?: Date | null;
  } | null,
  source?: "owned" | "library",
): Promise<BookDto> {
  const coverUrl = book.coverStorageKey
    ? await storage.getUrl(book.coverStorageKey)
    : null;

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
    pricingTier: book.pricingTier ?? null,
    sourceFormat: book.sourceFormat ?? null,
    blurb: book.blurb ?? null,
    coverUrl,
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

export interface ListPublishedOptions {
  /** Case-insensitive substring match against title OR author. */
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ListPublishedResult {
  books: (typeof books.$inferSelect)[];
  /** True when more rows exist beyond this page (offset + books.length). */
  hasMore: boolean;
}

const DEFAULT_PUBLISHED_PAGE_SIZE = 24;
const MAX_PUBLISHED_PAGE_SIZE = 60;

/**
 * Published books, newest first — the Discover feed. The catalog is
 * intentionally unbounded (self-draining Gutenberg ingestion keeps adding to
 * it), so this always pages via limit/offset rather than returning every
 * published book at once, and optionally filters to a case-insensitive
 * title/author substring search. No owner emails — title/author only.
 */
export async function listPublished(
  opts: ListPublishedOptions = {},
): Promise<ListPublishedResult> {
  await dbReady;

  const limit = Math.min(
    Math.max(1, opts.limit ?? DEFAULT_PUBLISHED_PAGE_SIZE),
    MAX_PUBLISHED_PAGE_SIZE,
  );
  const offset = Math.max(0, opts.offset ?? 0);

  const conditions = [eq(books.visibility, "published")];
  const q = opts.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(ilike(books.title, pattern), ilike(books.author, pattern))!,
    );
  }

  // Fetch one extra row to cheaply detect "more pages exist" without a
  // separate COUNT query.
  const rows = await db
    .select()
    .from(books)
    .where(and(...conditions))
    .orderBy(desc(books.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  return { books: hasMore ? rows.slice(0, limit) : rows, hasMore };
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

/**
 * Detaches a published book from a reader's library — the inverse of
 * `addToLibrary`. Deletes ONLY the reader's `purchases` row; the shared book
 * (and every other reader's library entry for it) is untouched, since the
 * book isn't theirs to delete. Returns whether a row was actually removed
 * (false if the book wasn't on their shelf via the library, e.g. they own it
 * instead — callers should route ownership-based removal to `deleteBook`).
 */
export async function removeFromLibrary(
  userId: string,
  bookId: string,
): Promise<boolean> {
  await dbReady;
  const deleted = await db
    .delete(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.bookId, bookId)))
    .returning();
  return deleted.length > 0;
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

/**
 * Permanently deletes a book (and cascades away chunks, progress, chat,
 * purchases, analysis — see the FK `onDelete: "cascade"` chain in
 * db/schema.ts) plus its stored source/cover blobs. This is destructive for
 * EVERYONE who has the book on their shelf, including other readers' library
 * entries — reserve it for the book's owner (or an admin takedown). A reader
 * who merely added someone else's published book to their library should be
 * routed to `removeFromLibrary` instead (see the DELETE
 * /api/books/[bookId] route, which picks between the two by ownership).
 */
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
 * Every chunk's text for a book, in reading order — the source data for the
 * table-of-contents scan (`collectToc` in `src/domain/reader-format.ts`) and
 * its accompanying per-chunk word counts. This reads the full text of every
 * chunk, so callers should treat it as a one-shot, not-cheap-for-huge-books
 * query (the `/toc` route fetches it once per reader session, not per page
 * turn).
 */
export async function getChunkTexts(
  bookId: string,
): Promise<{ idx: number; text: string }[]> {
  await dbReady;
  return db
    .select({ idx: chunks.idx, text: chunks.text })
    .from(chunks)
    .where(eq(chunks.bookId, bookId))
    .orderBy(asc(chunks.idx));
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
  frontierChunk?: number,
) {
  await dbReady;

  // Clamp to the book's real length: an unbounded client-supplied position
  // could otherwise push the spoiler frontier to "finished" and unlock every
  // reveal. Both values are clamped, never trusted raw.
  const [bookRow] = await db
    .select({ totalChunks: books.totalChunks })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  const maxChunk = Math.max(0, (bookRow?.totalChunks ?? 1) - 1);
  currentChunk = Math.min(Math.max(0, currentChunk), maxChunk);
  // The client may report the furthest chunk it reached this session (e.g. it
  // jumped forward then back within one debounce window); fold it into the
  // frontier so pages actually seen aren't under-recorded. Clamped + never
  // regresses (greatest() below).
  const reportedFrontier =
    frontierChunk == null
      ? currentChunk
      : Math.max(currentChunk, Math.min(Math.max(0, frontierChunk), maxChunk));

  const [row] = await db
    .insert(readingProgress)
    .values({ userId, bookId, currentChunk, frontierChunk: reportedFrontier })
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.bookId],
      set: {
        currentChunk,
        frontierChunk: sql`greatest(${readingProgress.frontierChunk}, ${reportedFrontier})`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return row;
}
