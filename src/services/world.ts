import { and, eq, inArray } from "drizzle-orm";
import { db, dbReady } from "@/db";
import {
  books,
  entities,
  entityAliases,
  jobs,
  overlays,
  readingProgress,
  worldReferences,
} from "@/db/schema";
import { inngest } from "@/jobs/client";

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

export interface DossierEntityDto {
  themeArchetype: string | null;
  entity: WorldEntityDto | null;
}

/**
 * Resolves a SINGLE entity by id for its dossier page. Unlike
 * {@link getWorldForReader}, membership is NOT frontier-filtered — a reader
 * who has the entity's id (e.g. followed a "Dossier →" link, or a shared URL)
 * can always open the page, even for a character introduced slightly ahead of
 * their frontier. Spoiler safety is preserved at the *attribute* level: the
 * same `reduceAttributes` buffer strips inner-life fields until earned, so
 * role/appearance are visible immediately but motivation/scars stay gated
 * exactly as they are in the rail. Returns `{entity: null}` when the world
 * isn't analyzed yet or no entity matches the id.
 */
export async function getEntityForDossier(opts: {
  bookId: string;
  userId: string;
  entityId: string;
  useFrontier: boolean;
}): Promise<DossierEntityDto> {
  await dbReady;

  const [world] = await db
    .select({ status: worldReferences.status })
    .from(worldReferences)
    .where(eq(worldReferences.bookId, opts.bookId))
    .limit(1);

  if (!world || world.status !== "completed") {
    return { themeArchetype: null, entity: null };
  }

  const [book] = await db
    .select({ themeArchetype: books.themeArchetype })
    .from(books)
    .where(eq(books.id, opts.bookId))
    .limit(1);
  const themeArchetype = book?.themeArchetype ?? "classic";

  const [entity] = await db
    .select()
    .from(entities)
    .where(
      and(eq(entities.bookId, opts.bookId), eq(entities.id, opts.entityId)),
    )
    .limit(1);

  if (!entity) return { themeArchetype, entity: null };

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

  return { themeArchetype, entity: toEntityDto(entity, frontierChunk) };
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
