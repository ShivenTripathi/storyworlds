import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { completeJson } from "@/ai/client";
import { generateSceneImage } from "@/ai/image";
import { assertBudget } from "@/ai/budget";
import { buildOverlayPrompt, OVERLAY_SYSTEM_PROMPT, type OverlayWorldContext } from "@/ai/prompts/overlay";
import { db, dbReady } from "@/db";
import { entities, entityAliases, images, overlays, worldReferences } from "@/db/schema";
import { buildAliasIndex, resolveEntityName } from "@/domain/entities/resolve";
import { OverlaySchema } from "@/domain/schemas";
import { env } from "@/lib/env";
import { inngest } from "@/jobs/client";
import { getChunk } from "@/services/books";
import { storage } from "@/services/storage";

/**
 * Per-page overlay generation (illustration + reading-companion notes),
 * created on demand as a reader reaches a page and prefetched a few pages
 * ahead. Unlike the whole-book analysis pipeline (src/jobs/analyze-book.ts),
 * this runs synchronously within a request (or a short prefetch job) for a
 * SINGLE page at a time, so it uses a lightweight row-level lock instead of
 * Inngest's durable step model.
 */

// A 'generating' row older than this is assumed to belong to a crashed/
// abandoned attempt and is safe to take over rather than leaving the reader
// stuck behind a dead lock forever.
const STALE_LOCK_MS = 3 * 60 * 1000;

type OverlayRow = typeof overlays.$inferSelect;

type LockResult =
  | { kind: "acquired" }
  | { kind: "ready"; row: OverlayRow }
  | { kind: "pending" };

async function acquireLock(bookId: string, chunkIdx: number): Promise<LockResult> {
  const [inserted] = await db
    .insert(overlays)
    .values({ bookId, chunkIdx, status: "generating" })
    .onConflictDoNothing({ target: [overlays.bookId, overlays.chunkIdx] })
    .returning();
  if (inserted) return { kind: "acquired" };

  const [existing] = await db
    .select()
    .from(overlays)
    .where(and(eq(overlays.bookId, bookId), eq(overlays.chunkIdx, chunkIdx)))
    .limit(1);

  if (!existing) {
    // Row vanished between the failed insert and this select (extremely
    // unlikely) — safe to proceed as if we'd acquired it fresh.
    return { kind: "acquired" };
  }

  if (existing.status === "ready") {
    return { kind: "ready", row: existing };
  }

  const ageMs = Date.now() - existing.createdAt.getTime();
  if (existing.status === "generating" && ageMs < STALE_LOCK_MS) {
    return { kind: "pending" };
  }

  // Either a stale 'generating' lock (attempt likely crashed) or a previous
  // 'failed' attempt — take over and retry.
  const [taken] = await db
    .update(overlays)
    .set({ status: "generating", createdAt: new Date() })
    .where(and(eq(overlays.bookId, bookId), eq(overlays.chunkIdx, chunkIdx)))
    .returning();
  return taken ? { kind: "acquired" } : { kind: "pending" };
}

function formatVisualStyle(visualStyle: unknown): string {
  if (!visualStyle || typeof visualStyle !== "object") return "";
  const v = visualStyle as Record<string, unknown>;
  return [v.artStyle, v.colorPalette, v.mood, v.eraSetting].filter(Boolean).join(", ");
}

/**
 * Generates (or fetches) the overlay row for one page, taking a lock so
 * concurrent requests for the same page don't duplicate LLM/image spend.
 * Returns the ready row, or `null` if another attempt is already in flight
 * (caller should treat this as "pending" and let the client retry/poll).
 */
export async function generateOverlayCore(
  bookId: string,
  chunkIdx: number,
  opts: { userId?: string } = {},
): Promise<OverlayRow | null> {
  await dbReady;

  const lock = await acquireLock(bookId, chunkIdx);
  if (lock.kind === "ready") return lock.row;
  if (lock.kind === "pending") return null;

  try {
    await assertBudget(bookId);

    const chunk = await getChunk(bookId, chunkIdx);
    if (!chunk) {
      throw new Error(`Chunk ${chunkIdx} not found for book ${bookId}`);
    }

    const [worldRow] = await db
      .select()
      .from(worldReferences)
      .where(eq(worldReferences.bookId, bookId))
      .limit(1);

    const entityRows = await db.select().from(entities).where(eq(entities.bookId, bookId));
    const aliasRows = await db
      .select()
      .from(entityAliases)
      .where(eq(entityAliases.bookId, bookId));

    const worldContext: OverlayWorldContext = {
      settingDescription: worldRow?.settingDescription ?? "",
      visualStyle: formatVisualStyle(worldRow?.visualStyle),
      entityNames: entityRows.map((e) => e.name),
    };

    const overlay = await completeJson({
      operation: "overlay",
      system: OVERLAY_SYSTEM_PROMPT,
      prompt: buildOverlayPrompt({ pageText: chunk.text, worldContext }),
      schema: OverlaySchema,
      bookId,
      userId: opts.userId,
    });

    const aliasIndex = buildAliasIndex(
      aliasRows.map((a) => ({ alias: a.aliasNorm, entityId: a.entityId })),
    );

    const resolvedIds: string[] = [];
    const seenIds = new Set<string>();
    const unresolvedMentions: { name: string; reason: string }[] = [];
    for (const active of overlay.activeEntities) {
      const result = resolveEntityName(active.name, aliasIndex);
      if ("entityId" in result) {
        if (!seenIds.has(result.entityId)) {
          seenIds.add(result.entityId);
          resolvedIds.push(result.entityId);
        }
      } else {
        unresolvedMentions.push({ name: result.unresolved, reason: result.reason });
      }
    }

    let imageId: string | null = null;
    if (env.IMAGE_INTERVAL > 0 && chunkIdx % env.IMAGE_INTERVAL === 0) {
      const topEntityIds = resolvedIds.slice(0, 2);
      let visualDescriptions: string[] = [];
      if (topEntityIds.length > 0) {
        const rows = await db
          .select({ visualDescription: entities.visualDescription })
          .from(entities)
          .where(and(eq(entities.bookId, bookId), inArray(entities.id, topEntityIds)));
        visualDescriptions = rows
          .map((r) => r.visualDescription)
          .filter((d): d is string => Boolean(d));
      }

      const imagePrompt = [
        overlay.sceneDescription,
        worldContext.visualStyle,
        ...visualDescriptions,
      ]
        .filter(Boolean)
        .join(". ");

      const image = await generateSceneImage(imagePrompt, { bookId, userId: opts.userId });
      if (image) {
        const storageKey = `books/${bookId}/images/${chunkIdx}.img`;
        await storage.put(storageKey, image.data, image.contentType);
        const [imageRow] = await db
          .insert(images)
          .values({
            bookId,
            chunkIdx,
            storageKey,
            prompt: imagePrompt,
            model: image.model,
          })
          .returning();
        imageId = imageRow.id;
      }
    }

    const [readyRow] = await db
      .update(overlays)
      .set({
        status: "ready",
        activeEntityIds: resolvedIds,
        unresolvedMentions,
        interpretiveLens: { notes: overlay.interpretiveNotes ?? null, mood: overlay.mood ?? null },
        sceneDescription: overlay.sceneDescription,
        suggestedQuestions: overlay.suggestedQuestions,
        imageId,
      })
      .where(and(eq(overlays.bookId, bookId), eq(overlays.chunkIdx, chunkIdx)))
      .returning();

    return readyRow;
  } catch (err) {
    console.error(
      `[overlays] generation failed for book ${bookId} chunk ${chunkIdx}:`,
      err,
    );
    await db
      .update(overlays)
      .set({ status: "failed" })
      .where(and(eq(overlays.bookId, bookId), eq(overlays.chunkIdx, chunkIdx)));
    throw err;
  }
}

export interface OverlayDto {
  chunkIdx: number;
  sceneDescription: string | null;
  interpretiveNotes: string | null;
  mood: string | null;
  suggestedQuestions: string[];
  activeEntities: { id: string; name: string; kind: string }[];
  imageUrl: string | null;
  imageIsForwardFill: boolean;
}

/**
 * Fetches the overlay for a page, generating it (and taking a lock so
 * concurrent callers don't double-spend) if it doesn't exist yet. Returns
 * `{ pending: true }` while another attempt is in flight.
 */
export async function getOrGenerateOverlay(
  bookId: string,
  chunkIdx: number,
  userId: string,
): Promise<OverlayDto | { pending: true }> {
  await dbReady;

  const row = await generateOverlayCore(bookId, chunkIdx, { userId });
  if (!row) return { pending: true };

  const activeIds = Array.isArray(row.activeEntityIds) ? (row.activeEntityIds as string[]) : [];
  let activeEntities: { id: string; name: string; kind: string }[] = [];
  if (activeIds.length > 0) {
    // No frontier filter here (unlike getWorldForReader): these are entities
    // the LLM found actively present in the text of THIS page, which the
    // reader is by definition already reading — there's no spoiler risk to
    // gate against, since nothing here reaches beyond the reader's frontier.
    activeEntities = await db
      .select({ id: entities.id, name: entities.name, kind: entities.kind })
      .from(entities)
      .where(and(eq(entities.bookId, bookId), inArray(entities.id, activeIds)));
  }

  const [imageRow] = await db
    .select()
    .from(images)
    .where(and(eq(images.bookId, bookId), lte(images.chunkIdx, chunkIdx)))
    .orderBy(desc(images.chunkIdx))
    .limit(1);

  let imageUrl: string | null = null;
  let imageIsForwardFill = false;
  if (imageRow) {
    imageUrl = await storage.getUrl(imageRow.storageKey);
    imageIsForwardFill = imageRow.chunkIdx !== chunkIdx;
  }

  const interpretiveLens = (row.interpretiveLens ?? {}) as {
    notes?: string | null;
    mood?: string | null;
  };

  return {
    chunkIdx: row.chunkIdx,
    sceneDescription: row.sceneDescription,
    interpretiveNotes: interpretiveLens.notes ?? null,
    mood: interpretiveLens.mood ?? null,
    suggestedQuestions: Array.isArray(row.suggestedQuestions)
      ? (row.suggestedQuestions as string[])
      : [],
    activeEntities,
    imageUrl,
    imageIsForwardFill,
  };
}

/**
 * Fire-and-forget: asks the background job to warm the next few pages'
 * overlays so they're ready by the time the reader gets there. Never throws
 * — a failed prefetch request just means the reader falls back to on-demand
 * (synchronous) generation for those pages.
 */
export async function requestPrefetch(bookId: string, fromIdx: number): Promise<void> {
  try {
    await inngest.send({
      name: "overlay/prefetch.requested",
      data: { bookId, fromIdx, count: 3 },
    });
  } catch (err) {
    console.error(
      `[overlays] failed to request prefetch for book ${bookId} from ${fromIdx}:`,
      err,
    );
  }
}
