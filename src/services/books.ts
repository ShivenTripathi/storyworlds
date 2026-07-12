import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, chunks, purchases, readingProgress } from "@/db/schema";
import { ApiError } from "@/lib/errors";
import { extractEpubText } from "@/services/epub";
import { extractPdf, type PdfPage } from "@/services/pdf";
import { storage } from "@/services/storage";

const CHUNK_INSERT_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Upload format detection
//
// Format is a detail of extraction, not a parallel code path: the upload
// route and createBookFromUpload both resolve a file to one of these three
// via detectBookFormat before anything else happens. Never trust the
// client-supplied MIME type alone — it's sniffed against magic bytes too.
// ---------------------------------------------------------------------------

export type BookSourceFormat = "pdf" | "epub" | "txt";

const EXTENSION_FORMAT: Record<string, BookSourceFormat> = {
  ".pdf": "pdf",
  ".epub": "epub",
  ".txt": "txt",
};

export const ACCEPTED_UPLOAD_EXTENSIONS = Object.keys(EXTENSION_FORMAT);

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

/** True if `bytes` starts with the given byte sequence. */
function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }
  return true;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

/**
 * Sniffs whether `data` looks like a well-formed EPUB zip: PK local-file-
 * header magic, and the near-mandatory first "mimetype" entry (stored
 * uncompressed, immediately after its header) spelling out
 * "application/epub+zip". This catches a renamed/spoofed non-EPUB zip
 * (e.g. a .docx) without paying for a full unzip.
 */
function looksLikeEpub(data: Uint8Array): boolean {
  if (!startsWith(data, ZIP_MAGIC)) return false;
  const head = new TextDecoder("latin1").decode(data.subarray(0, 256));
  return head.includes("mimetype") && head.includes("application/epub+zip");
}

/**
 * True if `data` looks like a decodable, non-binary text file: valid UTF-8
 * and no embedded NUL bytes in a reasonably-sized prefix (a strong signal
 * of a binary format masquerading as .txt).
 */
function looksLikePlainText(data: Uint8Array): boolean {
  const prefix = data.subarray(0, 8000);
  if (prefix.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(prefix);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves an uploaded file to a supported format by extension, then
 * verifies the claim against the file's actual magic bytes/content — never
 * trusts extension or client MIME type alone. Returns null (reject) for
 * unsupported extensions or a mismatch (e.g. a renamed non-PDF claiming
 * `.pdf`).
 */
export function detectBookFormat(
  filename: string,
  data: Uint8Array,
): BookSourceFormat | null {
  const format = EXTENSION_FORMAT[extensionOf(filename)];
  if (!format) return null;

  if (format === "pdf" && !startsWith(data, PDF_MAGIC)) return null;
  if (format === "epub" && !looksLikeEpub(data)) return null;
  if (format === "txt" && !looksLikePlainText(data)) return null;

  return format;
}

/** Decodes an uploaded .txt file as UTF-8, stripping a leading BOM. */
function decodeTextFile(data: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(data);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Strips a known upload extension for a filename-derived default title. */
function titleFromFilename(filename: string): string {
  const ext = extensionOf(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

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
    pricingTier?: string | null;
    sourceFormat?: string | null;
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
    pricingTier: book.pricingTier ?? null,
    sourceFormat: book.sourceFormat ?? null,
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
