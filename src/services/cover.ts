import { eq } from "drizzle-orm";
import { generateSceneImage } from "@/ai/image";
import { buildCoverPrompt, type CoverVisualStyle } from "@/ai/prompts/cover";
import { db, dbReady } from "@/db";
import { books, images, worldReferences } from "@/db/schema";
import { storage } from "@/services/storage";

/**
 * Generates (or fetches) a book's cover illustration — a spoiler-free "mood
 * of the world" cover in the same style as a real book jacket, built from
 * the book's title/author and its whole-book `visualStyle` (never plot
 * content; see src/ai/prompts/cover.ts). Uses the exact same pluggable image
 * pipeline as page overlays (src/ai/image.ts's `generateSceneImage`) so it
 * degrades gracefully to `null` — never throwing — whenever MODEL_IMAGE is
 * 'none'/unconfigured or the request fails for any reason (see CLAUDE.md
 * ZERO-COST CONSTRAINT: no paid image generation in prod).
 *
 * Callers (analyze-book.ts's persistWorld, the backfill sweep in
 * src/jobs/sweep-covers.ts) must treat a cover as a pure enhancement: never
 * let a failure here block or fail their own work.
 *
 * Idempotent: if the book already has a coverStorageKey, returns it as-is
 * without generating (and spending an image call) again.
 */
export async function generateCoverForBook(
  bookId: string,
): Promise<string | null> {
  try {
    await dbReady;

    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.id, bookId))
      .limit(1);
    if (!book) return null;
    if (book.coverStorageKey) return book.coverStorageKey;

    const [worldRow] = await db
      .select({ visualStyle: worldReferences.visualStyle })
      .from(worldReferences)
      .where(eq(worldReferences.bookId, bookId))
      .limit(1);

    const prompt = buildCoverPrompt({
      title: book.title,
      author: book.author,
      visualStyle: (worldRow?.visualStyle ?? null) as CoverVisualStyle | null,
      themeArchetype: book.themeArchetype ?? null,
    });

    const image = await generateSceneImage(prompt, { bookId });
    if (!image) return null;

    const storageKey = `books/${bookId}/cover.img`;
    await storage.put(storageKey, image.data, image.contentType);

    await db.insert(images).values({
      bookId,
      chunkIdx: null,
      storageKey,
      prompt,
      model: image.model,
    });

    await db
      .update(books)
      .set({ coverStorageKey: storageKey, updatedAt: new Date() })
      .where(eq(books.id, bookId));

    return storageKey;
  } catch (err) {
    console.error(`[cover] generation failed for book ${bookId}:`, err);
    return null;
  }
}
