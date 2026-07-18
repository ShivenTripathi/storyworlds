import { and, asc, eq, ilike, lte } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { bookmarks, chunks, highlights } from "@/db/schema";
import { escapeLikePattern } from "@/domain/like";
import { ApiError } from "@/lib/errors";

// ---------------------------------------------------------------------------
// Highlights (+ notes — a highlight-with-note IS how notes work here)
// ---------------------------------------------------------------------------

export interface HighlightDto {
  id: string;
  bookId: string;
  chunkIdx: number;
  text: string;
  color: string;
  note: string | null;
  createdAt: string;
}

function toHighlightDto(row: typeof highlights.$inferSelect): HighlightDto {
  return {
    id: row.id,
    bookId: row.bookId,
    chunkIdx: row.chunkIdx,
    text: row.text,
    color: row.color ?? "yellow",
    note: row.note ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CreateHighlightInput {
  userId: string;
  bookId: string;
  chunkIdx: number;
  text: string;
  color?: string;
  note?: string | null;
}

/** Creates a highlight (optionally with a note) scoped to the caller. */
export async function createHighlight(
  input: CreateHighlightInput,
): Promise<HighlightDto> {
  await dbReady;
  const [row] = await db
    .insert(highlights)
    .values({
      userId: input.userId,
      bookId: input.bookId,
      chunkIdx: input.chunkIdx,
      text: input.text,
      color: input.color ?? "yellow",
      note: input.note ?? null,
    })
    .returning();
  return toHighlightDto(row);
}

/** All of the caller's highlights for a book, in reading order. */
export async function listHighlights(
  userId: string,
  bookId: string,
): Promise<HighlightDto[]> {
  await dbReady;
  const rows = await db
    .select()
    .from(highlights)
    .where(and(eq(highlights.userId, userId), eq(highlights.bookId, bookId)))
    .orderBy(asc(highlights.chunkIdx), asc(highlights.createdAt));
  return rows.map(toHighlightDto);
}

export interface UpdateHighlightInput {
  color?: string;
  note?: string | null;
}

/**
 * Updates a highlight's color and/or note. Scoped to `userId` — a caller can
 * never mutate another reader's highlight; a mismatch (wrong owner, or the
 * id simply doesn't exist) is reported identically as 404 so existence of
 * another user's row is never leaked.
 */
export async function updateHighlight(
  userId: string,
  id: string,
  patch: UpdateHighlightInput,
): Promise<HighlightDto> {
  await dbReady;
  const set: Partial<typeof highlights.$inferInsert> = {};
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.note !== undefined) set.note = patch.note;

  if (Object.keys(set).length === 0) {
    const [existing] = await db
      .select()
      .from(highlights)
      .where(and(eq(highlights.id, id), eq(highlights.userId, userId)))
      .limit(1);
    if (!existing) throw new ApiError(404, "not_found", "Highlight not found.");
    return toHighlightDto(existing);
  }

  const [row] = await db
    .update(highlights)
    .set(set)
    .where(and(eq(highlights.id, id), eq(highlights.userId, userId)))
    .returning();
  if (!row) throw new ApiError(404, "not_found", "Highlight not found.");
  return toHighlightDto(row);
}

/** Deletes a highlight. Scoped to `userId` — see updateHighlight's note. */
export async function deleteHighlight(
  userId: string,
  id: string,
): Promise<void> {
  await dbReady;
  const deleted = await db
    .delete(highlights)
    .where(and(eq(highlights.id, id), eq(highlights.userId, userId)))
    .returning();
  if (deleted.length === 0) {
    throw new ApiError(404, "not_found", "Highlight not found.");
  }
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export interface BookmarkDto {
  id: string;
  bookId: string;
  chunkIdx: number;
  label: string | null;
  createdAt: string;
}

function toBookmarkDto(row: typeof bookmarks.$inferSelect): BookmarkDto {
  return {
    id: row.id,
    bookId: row.bookId,
    chunkIdx: row.chunkIdx,
    label: row.label ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface AddBookmarkInput {
  userId: string;
  bookId: string;
  chunkIdx: number;
  label?: string | null;
}

/**
 * Adds (or, on the same page, updates the label of) a bookmark. Upserts on
 * the (userId, bookId, chunkIdx) unique constraint rather than erroring on a
 * repeat bookmark of the same page.
 */
export async function addBookmark(
  input: AddBookmarkInput,
): Promise<BookmarkDto> {
  await dbReady;
  const [row] = await db
    .insert(bookmarks)
    .values({
      userId: input.userId,
      bookId: input.bookId,
      chunkIdx: input.chunkIdx,
      label: input.label ?? null,
    })
    .onConflictDoUpdate({
      target: [bookmarks.userId, bookmarks.bookId, bookmarks.chunkIdx],
      set: { label: input.label ?? null },
    })
    .returning();
  return toBookmarkDto(row);
}

/** All of the caller's bookmarks for a book, in reading order. */
export async function listBookmarks(
  userId: string,
  bookId: string,
): Promise<BookmarkDto[]> {
  await dbReady;
  const rows = await db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookId, bookId)))
    .orderBy(asc(bookmarks.chunkIdx));
  return rows.map(toBookmarkDto);
}

/** Removes a bookmark. Scoped to `userId` — see updateHighlight's note. */
export async function removeBookmark(
  userId: string,
  id: string,
): Promise<void> {
  await dbReady;
  const deleted = await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)))
    .returning();
  if (deleted.length === 0) {
    throw new ApiError(404, "not_found", "Bookmark not found.");
  }
}

// ---------------------------------------------------------------------------
// Frontier-gated in-book search
// ---------------------------------------------------------------------------

export interface SearchHit {
  chunkIdx: number;
  pageNumber: number | null;
  /** A ~120-char window of the chunk's text around the match. */
  snippet: string;
  /** Offset of the match within `snippet` (for the caller to bold/mark it). */
  matchStart: number;
  matchLength: number;
}

export interface SearchBookOptions {
  bookId: string;
  q: string;
  /**
   * SPOILER-FRONTIER (hard invariant): true by default. Only pass `false`
   * once the CALLER (the route) has already verified the requester is the
   * book's owner or an admin AND explicitly asked to search ahead — this
   * function does no permission check of its own, mirroring the
   * `useFrontier` convention in `src/services/world.ts`'s
   * `getWorldForReader`. An unfiltered search is a direct spoiler leak (a
   * reader could search a character's name and land on their death scene
   * three chapters ahead), so the default here must never change.
   */
  useFrontier?: boolean;
  /** The reader's frontier chunk — required (and only meaningful) when
   * `useFrontier` is true; treated as 0 (nothing read yet) if omitted. */
  frontierChunk?: number;
  limit?: number;
}

const SEARCH_CONTEXT_CHARS = 60;
const SEARCH_DEFAULT_LIMIT = 30;
const SEARCH_MAX_LIMIT = 100;

/**
 * Case-insensitive full-text search over a book's chunks, gated to the
 * reader's spoiler frontier by default (see `useFrontier` above). Returns
 * one hit per matching chunk (first match only), each with a short
 * highlighted-in-place snippet.
 */
export async function searchBook(
  opts: SearchBookOptions,
): Promise<SearchHit[]> {
  await dbReady;
  const q = opts.q.trim();
  if (!q) return [];

  const useFrontier = opts.useFrontier ?? true;
  const limit = Math.min(
    Math.max(1, opts.limit ?? SEARCH_DEFAULT_LIMIT),
    SEARCH_MAX_LIMIT,
  );

  const conditions = [
    eq(chunks.bookId, opts.bookId),
    ilike(chunks.text, `%${escapeLikePattern(q)}%`),
  ];
  if (useFrontier) {
    conditions.push(lte(chunks.idx, Math.max(0, opts.frontierChunk ?? 0)));
  }

  const rows = await db
    .select({
      idx: chunks.idx,
      pageNumber: chunks.pageNumber,
      text: chunks.text,
    })
    .from(chunks)
    .where(and(...conditions))
    .orderBy(asc(chunks.idx))
    .limit(limit);

  const hits: SearchHit[] = [];
  for (const row of rows) {
    const snippet = buildSnippet(row.text, q);
    if (!snippet) continue; // ILIKE can match text SQL-escaping normalized away; be defensive
    hits.push({ chunkIdx: row.idx, pageNumber: row.pageNumber, ...snippet });
  }
  return hits;
}

function buildSnippet(
  text: string,
  q: string,
): { snippet: string; matchStart: number; matchLength: number } | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const idx = normalized.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;

  const start = Math.max(0, idx - SEARCH_CONTEXT_CHARS);
  const end = Math.min(
    normalized.length,
    idx + q.length + SEARCH_CONTEXT_CHARS,
  );
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";

  return {
    snippet: prefix + normalized.slice(start, end) + suffix,
    matchStart: prefix.length + (idx - start),
    matchLength: q.length,
  };
}
