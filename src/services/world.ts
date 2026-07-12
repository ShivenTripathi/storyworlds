import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { db, dbReady } from "@/db";
import {
  books,
  entities,
  entityAliases,
  images,
  jobs,
  overlays,
  readingProgress,
  worldReferences,
} from "@/db/schema";
import { inngest } from "@/jobs/client";
import { storage } from "@/services/storage";

export interface WorldEntityDto {
  id: string;
  name: string;
  kind: string;
  attributes: unknown;
  visualDescription: string | null;
  introducedAtChunk: number | null;
}

export interface WorldJobDto {
  id: string;
  status: string | null;
  progress: number | null;
  stage: string | null;
}

export interface WorldDto {
  status: string;
  settingDescription?: string | null;
  visualStyle?: unknown;
  themeArchetype?: string | null;
  timeline?: unknown[];
  entities?: WorldEntityDto[];
  counts?: { total: number; visible: number };
  job?: WorldJobDto;
}

interface TimelineItem {
  chunk?: number | null;
  page?: number | null;
  [key: string]: unknown;
}

// A character's inner life (motivation, scars, internal state) is a spoiler
// until the reader has spent time with them — mirrors the same buffer the
// chat persona builder uses so the dossier and chat never disagree.
const INNER_LIFE_REVEAL_BUFFER_CHUNKS = 20;
const INNER_LIFE_KEYS = ["internalState", "keyMotivation", "scars"];

/** Strips inner-life fields from an entity's attributes until earned. */
function reduceAttributes(
  attributes: unknown,
  introducedAtChunk: number | null,
  frontierChunk: number | null,
): unknown {
  if (frontierChunk === null) return attributes; // unfiltered (owner/admin full view)
  if (attributes === null || typeof attributes !== "object") return attributes;
  const earned =
    introducedAtChunk != null &&
    frontierChunk >= introducedAtChunk + INNER_LIFE_REVEAL_BUFFER_CHUNKS;
  if (earned) return attributes;
  const out: Record<string, unknown> = {
    ...(attributes as Record<string, unknown>),
  };
  for (const k of INNER_LIFE_KEYS) delete out[k];
  return out;
}

/**
 * Loads the world reference for a book, filtered to what's safe to show a
 * given reader given their frontier (max chunk ever reached). Frontier
 * filtering is the DEFAULT; pass `useFrontier: false` only for an owner/admin
 * full-view (never from the client). If no analysis has completed yet,
 * returns `{status: 'none'}` (plus a `job` if one is currently queued/running).
 */
export async function getWorldForReader(opts: {
  bookId: string;
  userId: string;
  useFrontier: boolean;
}): Promise<WorldDto> {
  await dbReady;

  const [world] = await db
    .select()
    .from(worldReferences)
    .where(eq(worldReferences.bookId, opts.bookId))
    .limit(1);

  if (!world || world.status !== "completed") {
    const [runningJob] = await db
      .select({
        id: jobs.id,
        status: jobs.status,
        progress: jobs.progress,
        stage: jobs.stage,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.bookId, opts.bookId),
          eq(jobs.kind, "analyze_book"),
          inArray(jobs.status, ["queued", "running"]),
        ),
      )
      .limit(1);

    return {
      status: world?.status ?? "none",
      job: runningJob,
    };
  }

  const [book] = await db
    .select({ themeArchetype: books.themeArchetype })
    .from(books)
    .where(eq(books.id, opts.bookId))
    .limit(1);

  let frontierChunk: number | null = null;
  if (opts.useFrontier) {
    const [progress] = await db
      .select({ frontierChunk: readingProgress.frontierChunk })
      .from(readingProgress)
      .where(
        and(
          eq(readingProgress.userId, opts.userId),
          eq(readingProgress.bookId, opts.bookId),
        ),
      )
      .limit(1);
    frontierChunk = progress?.frontierChunk ?? 0;
  }

  const entityRows = await db
    .select()
    .from(entities)
    .where(eq(entities.bookId, opts.bookId));

  const visibleEntities = entityRows.filter((e) => {
    if (frontierChunk === null) return true;
    if (e.introducedAtChunk === null || e.introducedAtChunk === undefined)
      return true;
    return e.introducedAtChunk <= frontierChunk;
  });

  const timeline = Array.isArray(world.timeline)
    ? (world.timeline as TimelineItem[])
    : [];
  const filteredTimeline =
    frontierChunk === null
      ? timeline
      : timeline.filter((item) => {
          const chunk = item.chunk;
          if (typeof chunk !== "number") return true;
          return chunk <= frontierChunk;
        });

  return {
    status: world.status ?? "completed",
    settingDescription: world.settingDescription,
    visualStyle: world.visualStyle,
    themeArchetype: book?.themeArchetype ?? "classic",
    timeline: filteredTimeline,
    entities: visibleEntities.map((e) => toEntityDto(e, frontierChunk)),
    counts: { total: entityRows.length, visible: visibleEntities.length },
  };
}

/** A framed scene illustration featuring the character (earliest within frontier). */
export interface DossierVisual {
  imageUrl: string | null;
  caption: string | null;
  page: number | null; // 1-based page the illustrated scene is drawn from
}

/** Where in the read-so-far book the character is active. */
export interface DossierAppearances {
  pageCount: number; // number of pages (overlays) they're active on, within frontier
  firstPage: number | null; // 1-based
  lastPage: number | null; // 1-based
  ticks: number[]; // 0-based chunk indices they appear on (for a sparkline)
  frontierChunk: number | null; // reader's frontier (null = full/owner view)
  totalChunks: number | null; // book length, for the sparkline extent
}

/** Another entity the character shares scenes with, ranked by shared pages. */
export interface DossierRelationship {
  id: string;
  name: string;
  kind: string;
  sharedPages: number;
}

export interface DossierDto {
  themeArchetype: string | null;
  entity: WorldEntityDto | null;
  /** True when this character HAS inner-life fields that the frontier is still hiding. */
  innerLifeGated: boolean;
  visual: DossierVisual;
  appearances: DossierAppearances;
  relationships: DossierRelationship[];
}

const EMPTY_VISUAL: DossierVisual = {
  imageUrl: null,
  caption: null,
  page: null,
};

/** First sentence of a scene description, for the portrait caption. */
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?=\s|$)/);
  return (match ? match[0] : text).trim();
}

function activeIdsOf(row: { activeEntityIds: unknown }): string[] {
  return Array.isArray(row.activeEntityIds)
    ? (row.activeEntityIds as string[])
    : [];
}

/**
 * Resolves a SINGLE entity by id for its dossier page, enriched with data we
 * already have — all of it frontier-gated. Unlike {@link getWorldForReader},
 * membership is NOT frontier-filtered: a reader who has the entity's id (e.g.
 * followed a "Dossier →" link, or a shared URL) can always open the page, even
 * for a character introduced slightly ahead of their frontier. Spoiler safety
 * is preserved everywhere the content could run ahead of the reader:
 *   - inner-life attributes (motivation/scars/internal state) are stripped by
 *     the same `reduceAttributes` buffer as the rail until earned;
 *   - appearances + the illustrated scene only consider pages at/behind the
 *     frontier;
 *   - co-occurring characters are only surfaced once introduced at/behind the
 *     frontier — a character the reader hasn't met yet never leaks here.
 * Returns `{entity: null}` when the world isn't analyzed yet or no entity
 * matches the id.
 */
export async function getDossier(opts: {
  bookId: string;
  userId: string;
  entityId: string;
  useFrontier: boolean;
}): Promise<DossierDto> {
  await dbReady;

  const empty: DossierDto = {
    themeArchetype: null,
    entity: null,
    innerLifeGated: false,
    visual: EMPTY_VISUAL,
    appearances: {
      pageCount: 0,
      firstPage: null,
      lastPage: null,
      ticks: [],
      frontierChunk: null,
      totalChunks: null,
    },
    relationships: [],
  };

  const [world] = await db
    .select({ status: worldReferences.status })
    .from(worldReferences)
    .where(eq(worldReferences.bookId, opts.bookId))
    .limit(1);

  if (!world || world.status !== "completed") return empty;

  const [book] = await db
    .select({
      themeArchetype: books.themeArchetype,
      totalChunks: books.totalChunks,
    })
    .from(books)
    .where(eq(books.id, opts.bookId))
    .limit(1);
  const themeArchetype = book?.themeArchetype ?? "classic";
  const totalChunks = book?.totalChunks ?? null;

  const [entity] = await db
    .select()
    .from(entities)
    .where(
      and(eq(entities.bookId, opts.bookId), eq(entities.id, opts.entityId)),
    )
    .limit(1);

  if (!entity) return { ...empty, themeArchetype };

  let frontierChunk: number | null = null;
  if (opts.useFrontier) {
    const [progress] = await db
      .select({ frontierChunk: readingProgress.frontierChunk })
      .from(readingProgress)
      .where(
        and(
          eq(readingProgress.userId, opts.userId),
          eq(readingProgress.bookId, opts.bookId),
        ),
      )
      .limit(1);
    frontierChunk = progress?.frontierChunk ?? 0;
  }

  // Does this character have inner-life content the frontier is still hiding?
  // (Drives the "you'll learn more as you read" affordance — only shown when
  // there's actually something sealed, never as dead chrome.)
  const rawAttrs =
    entity.attributes && typeof entity.attributes === "object"
      ? (entity.attributes as Record<string, unknown>)
      : null;
  const hasHiddenInnerLife = Boolean(
    rawAttrs && INNER_LIFE_KEYS.some((k) => rawAttrs[k]),
  );
  const earned =
    entity.introducedAtChunk != null &&
    frontierChunk !== null &&
    frontierChunk >= entity.introducedAtChunk + INNER_LIFE_REVEAL_BUFFER_CHUNKS;
  const innerLifeGated =
    frontierChunk !== null && hasHiddenInnerLife && !earned;

  // Overlays within the frontier — the raw material for appearances,
  // relationships, and the illustrated scene.
  const overlayConds = [
    eq(overlays.bookId, opts.bookId),
    eq(overlays.status, "ready"),
  ];
  if (frontierChunk !== null) {
    overlayConds.push(lte(overlays.chunkIdx, frontierChunk));
  }
  const overlayRows = await db
    .select({
      chunkIdx: overlays.chunkIdx,
      activeEntityIds: overlays.activeEntityIds,
      imageId: overlays.imageId,
      sceneDescription: overlays.sceneDescription,
    })
    .from(overlays)
    .where(and(...overlayConds))
    .orderBy(asc(overlays.chunkIdx));

  const appearanceRows = overlayRows.filter((o) =>
    activeIdsOf(o).includes(opts.entityId),
  );
  const ticks = appearanceRows.map((o) => o.chunkIdx);

  const appearances: DossierAppearances = {
    pageCount: appearanceRows.length,
    firstPage: ticks.length ? ticks[0] + 1 : null,
    lastPage: ticks.length ? ticks[ticks.length - 1] + 1 : null,
    ticks,
    frontierChunk,
    totalChunks,
  };

  // Visual anchor: the earliest illustrated scene featuring this character.
  let visual: DossierVisual = EMPTY_VISUAL;
  const withImage = appearanceRows.find((o) => o.imageId);
  if (withImage?.imageId) {
    const [img] = await db
      .select({ storageKey: images.storageKey })
      .from(images)
      .where(eq(images.id, withImage.imageId))
      .limit(1);
    if (img) {
      visual = {
        imageUrl: await storage.getUrl(img.storageKey),
        caption: withImage.sceneDescription
          ? firstSentence(withImage.sceneDescription)
          : null,
        page: withImage.chunkIdx + 1,
      };
    }
  }

  // Relationships: co-occurrence across shared scenes, ranked by shared pages.
  const sharedCount = new Map<string, number>();
  for (const o of appearanceRows) {
    for (const id of activeIdsOf(o)) {
      if (id === opts.entityId) continue;
      sharedCount.set(id, (sharedCount.get(id) ?? 0) + 1);
    }
  }

  let relationships: DossierRelationship[] = [];
  if (sharedCount.size > 0) {
    const coRows = await db
      .select({
        id: entities.id,
        name: entities.name,
        kind: entities.kind,
        introducedAtChunk: entities.introducedAtChunk,
      })
      .from(entities)
      .where(
        and(
          eq(entities.bookId, opts.bookId),
          inArray(entities.id, [...sharedCount.keys()]),
        ),
      );
    relationships = coRows
      // Frontier gate: never surface a character the reader hasn't met, even
      // if a page they co-occur on happens to sit behind the frontier.
      .filter(
        (r) =>
          frontierChunk === null ||
          r.introducedAtChunk == null ||
          r.introducedAtChunk <= frontierChunk,
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        sharedPages: sharedCount.get(r.id) ?? 0,
      }))
      .sort(
        (a, b) => b.sharedPages - a.sharedPages || a.name.localeCompare(b.name),
      );
  }

  return {
    themeArchetype,
    entity: toEntityDto(entity, frontierChunk),
    innerLifeGated,
    visual,
    appearances,
    relationships,
  };
}

/**
 * Wipes a book's analysis (world reference, entities, aliases, overlays)
 * and enqueues a fresh `analyze_book` job — the same wipe-and-reanalyze
 * logic the reader-facing `POST /api/books/[bookId]/analyze?force=1` route
 * uses, extracted here so the admin "retry analysis" action can share it
 * without duplicating the reset semantics.
 */
export async function resetAndEnqueueAnalysis(bookId: string, userId: string) {
  await dbReady;

  await db.delete(overlays).where(eq(overlays.bookId, bookId));
  await db.delete(entityAliases).where(eq(entityAliases.bookId, bookId));
  await db.delete(entities).where(eq(entities.bookId, bookId));
  await db.delete(worldReferences).where(eq(worldReferences.bookId, bookId));

  const [job] = await db
    .insert(jobs)
    .values({
      bookId,
      userId,
      kind: "analyze_book",
      status: "queued",
      progress: 0,
      stage: "Queued…",
    })
    .returning();

  await inngest.send({
    name: "book/analyze.requested",
    data: { bookId, jobId: job.id },
  });

  return job;
}

function toEntityDto(
  e: typeof entities.$inferSelect,
  frontierChunk: number | null,
): WorldEntityDto {
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    attributes: reduceAttributes(
      e.attributes,
      e.introducedAtChunk,
      frontierChunk,
    ),
    visualDescription: e.visualDescription,
    introducedAtChunk: e.introducedAtChunk,
  };
}
