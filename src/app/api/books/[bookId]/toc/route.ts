import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { countWords } from "@/domain/book-format";
import { collectToc } from "@/domain/reader-format";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getChunkTexts } from "@/services/books";

type Params = { params: Promise<{ bookId: string }> };

/**
 * GET /api/books/:bookId/toc
 *
 * Table-of-contents jump menu source data, derived purely from the existing
 * chapter/section heading detection in `src/domain/reader-format.ts` — no
 * LLM call, no new schema, no cached column. Scans every chunk's text once
 * per request; the reader fetches this a single time per session (see
 * `src/components/reader/Reader.tsx`), not on every page turn.
 *
 * Jumping to any chapter — including ones ahead of the reader's current
 * position — is allowed by design (Kindle does the same): the world/
 * Discoveries surfaces stay frontier-gated server-side regardless of where
 * the reader's cursor sits, so revealing a chapter *title* here carries no
 * spoiler risk on its own.
 *
 * Response:
 *   { chapters: { title: string; chunkIdx: number }[], wordCounts: number[] }
 * `wordCounts[i]` is chunk `i`'s word count (0 for indices with no chunk),
 * the data the reader's "time left in chapter/book" estimate is computed
 * from client-side (see `src/domain/reading-pace.ts`).
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId } = await requireUser();
    const book = await requireBookAccess(bookId, userId);

    const rows = await getChunkTexts(bookId);
    const chapters = collectToc(rows);

    const size = Math.max(book.totalChunks ?? 0, ...rows.map((r) => r.idx + 1));
    const wordCounts = new Array<number>(size).fill(0);
    for (const row of rows) {
      wordCounts[row.idx] = countWords(row.text);
    }

    return NextResponse.json({ chapters, wordCounts });
  } catch (e) {
    return handleApiError(e);
  }
}
