import { eq } from "drizzle-orm";
import { completeJson } from "@/ai/client";
import {
  buildFunFactsPrompt,
  FUNFACTS_SYSTEM_PROMPT,
} from "@/ai/prompts/funfacts";
import { db, dbReady } from "@/db";
import { books, worldReferences } from "@/db/schema";
import { FunFactsSchema, type FunFacts } from "@/domain/schemas";

/**
 * Generates (or fetches) a book's spoiler-free "fun facts" — a short "Did
 * you know?" layer (author life, publication/historical context, trivia,
 * cultural legacy) built from ONLY the book's title/author (+ an optional
 * era hint from its already-synthesized visualStyle). See src/ai/prompts/
 * funfacts.ts for the full spoiler-safety + accuracy-over-coverage rationale.
 *
 * Mirrors src/services/cover.ts's shape exactly: best-effort (never throws —
 * every caller, including analyze-book.ts's persistWorld, must be able to
 * treat this as a pure enhancement), idempotent (a book that already has
 * funFacts is returned as-is, spending no additional free-tier request), and
 * safe to call before a visualStyle exists (the era hint is simply omitted).
 *
 * Returns the stored FunFacts on success, or null if generation was skipped/
 * failed for any reason.
 */
export async function generateFunFactsForBook(
  bookId: string,
): Promise<FunFacts | null> {
  try {
    await dbReady;

    const [book] = await db
      .select({
        id: books.id,
        title: books.title,
        author: books.author,
        funFacts: books.funFacts,
      })
      .from(books)
      .where(eq(books.id, bookId))
      .limit(1);
    if (!book) return null;
    if (book.funFacts) return book.funFacts as FunFacts;

    const [worldRow] = await db
      .select({ visualStyle: worldReferences.visualStyle })
      .from(worldReferences)
      .where(eq(worldReferences.bookId, bookId))
      .limit(1);
    const visualStyle = worldRow?.visualStyle as
      { eraSetting?: string | null } | null | undefined;

    const result = await completeJson({
      operation: "funfacts",
      system: FUNFACTS_SYSTEM_PROMPT,
      prompt: buildFunFactsPrompt({
        title: book.title,
        author: book.author,
        era: visualStyle?.eraSetting ?? null,
      }),
      schema: FunFactsSchema,
      bookId,
    });

    await db
      .update(books)
      .set({ funFacts: result, updatedAt: new Date() })
      .where(eq(books.id, bookId));

    return result;
  } catch (err) {
    console.error(`[funfacts] generation failed for book ${bookId}:`, err);
    return null;
  }
}
