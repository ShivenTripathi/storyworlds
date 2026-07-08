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

/**
 * Loads the world reference for a book, filtered to what's safe to show a
 * given reader given their frontier (max chunk ever reached). If no
 * analysis has completed yet, returns `{status: 'none'}` (plus a `job` if
 * one is currently queued/running).
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
      .select({ id: jobs.id, status: jobs.status, progress: jobs.progress, stage: jobs.stage })
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
        and(eq(readingProgress.userId, opts.userId), eq(readingProgress.bookId, opts.bookId)),
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
    if (e.introducedAtChunk === null || e.introducedAtChunk === undefined) return true;
    return e.introducedAtChunk <= frontierChunk;
  });

  const timeline = Array.isArray(world.timeline) ? (world.timeline as TimelineItem[]) : [];
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
    entities: visibleEntities.map(toEntityDto),
    counts: { total: entityRows.length, visible: visibleEntities.length },
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

function toEntityDto(e: typeof entities.$inferSelect): WorldEntityDto {
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    attributes: e.attributes,
    visualDescription: e.visualDescription,
    introducedAtChunk: e.introducedAtChunk,
  };
}
