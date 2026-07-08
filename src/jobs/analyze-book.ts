import { asc, eq } from "drizzle-orm";
import { completeJson } from "@/ai/client";
import { buildSegmentPrompt, SEGMENT_SYSTEM_PROMPT } from "@/ai/prompts/segment";
import { buildSynthesisPrompt, SYNTHESIS_SYSTEM_PROMPT } from "@/ai/prompts/synthesis";
import { db, dbReady } from "@/db";
import { books, chunks, entities, entityAliases, jobs, worldReferences } from "@/db/schema";
import { derivedAliases, normalizeAlias } from "@/domain/entities/resolve";
import { dedupeSlug, slugifyEntity, type EntityKind } from "@/domain/entities/slug";
import {
  pageToChunkIdx,
  SegmentAnalysisSchema,
  WorldSynthesisSchema,
  type SegmentAnalysis,
  type WorldSynthesis,
} from "@/domain/schemas";
import { segmentChunks } from "@/domain/segmentation";
import { env } from "@/lib/env";
import { generateOverlayCore } from "@/services/overlays";
import { inngest } from "./client";

// ---------------------------------------------------------------------------
// Pipeline core — a plain async function so it can be invoked directly in
// tests/scripts (stepRunner defaults to immediate execution) or wrapped by
// Inngest's `step.run` for durable execution (see analyzeBook below).
// ---------------------------------------------------------------------------

export type StepRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

const defaultStepRunner: StepRunner = (_name, fn) => fn();

const MAX_STORED_STRING = 500;
const SEGMENT_CONCURRENCY = 3;

function truncate(s: string | undefined, max = MAX_STORED_STRING): string | undefined {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) : s;
}

/** Keep step outputs small — Inngest memoizes every step's return value. */
function truncateSegmentAnalysis(result: SegmentAnalysis): SegmentAnalysis {
  return {
    ...result,
    entities: result.entities.map((e) => ({
      ...e,
      description: truncate(e.description) ?? "",
      visualDescription: truncate(e.visualDescription),
    })),
    events: result.events.map((ev) => ({ ...ev, summary: truncate(ev.summary) ?? "" })),
    settingNotes: truncate(result.settingNotes),
  };
}

async function updateJob(jobId: string, patch: Partial<typeof jobs.$inferInsert>) {
  await dbReady;
  await db
    .update(jobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

/** Run `worker` over `items` with at most `limit` in flight concurrently. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function next(): Promise<void> {
    const i = cursor;
    cursor += 1;
    if (i >= items.length) return;
    await worker(items[i], i);
    return next();
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => next()));
}

function buildNotesDigest(results: SegmentAnalysis[]): string {
  return results
    .map((r, i) => {
      const entityLines =
        r.entities
          .slice(0, 10)
          .map(
            (e) =>
              `- ${e.name} (${e.kind}${e.aliases.length ? `, aka ${e.aliases.join(", ")}` : ""}): ${e.description}`,
          )
          .join("\n") || "(none)";
      const eventLines = r.events.slice(0, 5).map((ev) => `- ${ev.summary}`).join("\n") || "(none)";
      return `--- PART ${i + 1} ---\nEntities:\n${entityLines}\nEvents:\n${eventLines}\nSetting notes: ${r.settingNotes ?? "(none)"}`;
    })
    .join("\n\n");
}

async function persistWorld(
  bookId: string,
  synthesis: WorldSynthesis,
  segmentResults: SegmentAnalysis[],
): Promise<void> {
  await dbReady;

  const taken = new Set<string>();
  const mintedIds = synthesis.entities.map((e) => {
    const baseSlug = slugifyEntity(e.kind as EntityKind, e.name);
    const id = dedupeSlug(baseSlug, taken);
    taken.add(id);
    return id;
  });

  if (synthesis.entities.length > 0) {
    await db.insert(entities).values(
      synthesis.entities.map((e, i) => ({
        bookId,
        id: mintedIds[i],
        name: e.name,
        kind: e.kind,
        introducedAtChunk:
          e.introducedAtPage !== undefined ? pageToChunkIdx(e.introducedAtPage) : null,
        attributes: e.attributes,
        visualDescription: e.visualDescription ?? null,
      })),
    );
  }

  // Alias table: normalize every name variant + derived alias; first entity
  // to claim a normalized alias wins, collisions are logged and skipped.
  const claimedAliases = new Set<string>();
  const aliasRows: { bookId: string; aliasNorm: string; entityId: string }[] = [];
  synthesis.entities.forEach((e, i) => {
    const entityId = mintedIds[i];
    const candidates = [e.name, ...e.aliases, ...derivedAliases(e.name)];
    for (const candidate of candidates) {
      const norm = normalizeAlias(candidate);
      if (!norm) continue;
      if (claimedAliases.has(norm)) {
        console.warn(
          `[analyze-book] alias collision for "${norm}" on book ${bookId} — first entity keeps it, skipping for ${entityId}`,
        );
        continue;
      }
      claimedAliases.add(norm);
      aliasRows.push({ bookId, aliasNorm: norm, entityId });
    }
  });

  if (aliasRows.length > 0) {
    await db.insert(entityAliases).values(aliasRows);
  }

  const modelVersions = { segment: env.MODEL_SEGMENT, synthesis: env.MODEL_SYNTHESIS };
  const worldValues = {
    status: "completed" as const,
    settingDescription: synthesis.settingDescription,
    visualStyle: synthesis.visualStyle,
    timeline: synthesis.timeline,
    commitments: synthesis.commitments,
    unknowns: synthesis.unknowns,
    segmentResults,
    modelVersions,
  };

  await db
    .insert(worldReferences)
    .values({ bookId, ...worldValues })
    .onConflictDoUpdate({
      target: worldReferences.bookId,
      set: { ...worldValues, updatedAt: new Date() },
    });

  await db
    .update(books)
    .set({ themeArchetype: synthesis.visualStyle.themeArchetype, updatedAt: new Date() })
    .where(eq(books.id, bookId));
}

/**
 * Core pipeline logic, decoupled from Inngest so it can be exercised
 * directly (e.g. in tests) with the default immediate-execution
 * `stepRunner`. The Inngest-wrapped function below injects `step.run` as the
 * runner for durable, resumable execution.
 */
export async function runAnalysis(
  bookId: string,
  jobId: string,
  stepRunner: StepRunner = defaultStepRunner,
): Promise<void> {
  await dbReady;

  const { segments, bookTitle, totalChunks } = await stepRunner("load", async () => {
    const [bookRow] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
    if (!bookRow) throw new Error("Book not found");

    const chunkRows = await db
      .select({ idx: chunks.idx, text: chunks.text })
      .from(chunks)
      .where(eq(chunks.bookId, bookId))
      .orderBy(asc(chunks.idx));

    const segs = segmentChunks(chunkRows);

    await updateJob(jobId, { status: "running", stage: "Reading the manuscript…", progress: 5 });

    return { segments: segs, bookTitle: bookRow.title, totalChunks: chunkRows.length };
  });

  const total = segments.length;
  const segmentResults: SegmentAnalysis[] = new Array(total);
  let done = 0;

  await runWithConcurrency(segments, SEGMENT_CONCURRENCY, async (segment, i) => {
    const result = await stepRunner(`segment-${i}`, async () => {
      const analysis = await completeJson({
        operation: "segment",
        system: SEGMENT_SYSTEM_PROMPT,
        prompt: buildSegmentPrompt({ index: segment.index, totalSegments: total, text: segment.text }),
        schema: SegmentAnalysisSchema,
        bookId,
      });
      return truncateSegmentAnalysis(analysis);
    });

    segmentResults[i] = result;
    done += 1;
    await updateJob(jobId, {
      progress: 5 + Math.round(60 * (done / total)),
      stage: `Meeting the characters… (${done}/${total})`,
    });
  });

  await updateJob(jobId, { stage: "Weaving the world…", progress: 70 });

  const notesDigest = buildNotesDigest(segmentResults);
  const synthesis = await stepRunner("synthesize", () =>
    completeJson({
      operation: "synthesis",
      system: SYNTHESIS_SYSTEM_PROMPT,
      prompt: buildSynthesisPrompt({ bookTitle, totalSegments: total, notesDigest }),
      schema: WorldSynthesisSchema,
      bookId,
    }),
  );

  await stepRunner("persist", async () => {
    await persistWorld(bookId, synthesis, segmentResults);
    await updateJob(jobId, { progress: 90, status: "running", stage: "The world is ready." });
  });

  // Warm-start: pre-generate overlays (illustration + companion notes) for
  // the opening pages so the reader's first session doesn't stall on
  // on-demand generation. Best-effort — a failure here never fails the
  // overall analysis job, since overlays regenerate lazily per page anyway.
  const warmStartLastIdx = Math.min(10, totalChunks - 1);
  if (warmStartLastIdx >= 0) {
    await stepRunner("warm-start", async () => {
      const warmStartCount = warmStartLastIdx + 1;
      for (let idx = 0; idx <= warmStartLastIdx; idx++) {
        try {
          await generateOverlayCore(bookId, idx);
        } catch (err) {
          console.error(
            `[analyze-book] warm-start overlay failed for book ${bookId} chunk ${idx}:`,
            err,
          );
        }
        await updateJob(jobId, {
          progress: 92 + Math.round(7 * ((idx + 1) / warmStartCount)),
          stage: `Illustrating the opening pages… (${idx + 1}/${warmStartCount})`,
        });
      }
    });
  }

  await updateJob(jobId, { progress: 100, status: "completed", stage: "The world is ready." });
}

// ---------------------------------------------------------------------------
// Inngest wiring
// ---------------------------------------------------------------------------

export const analyzeBook = inngest.createFunction(
  {
    id: "analyze-book",
    concurrency: 3,
    triggers: [{ event: "book/analyze.requested" }],
    onFailure: async ({ event }) => {
      const jobId = (event.data as { event?: { data?: { jobId?: string } } }).event?.data?.jobId;
      if (!jobId) return;
      try {
        await updateJob(jobId, {
          status: "failed",
          error: "Analysis failed. Please try again or contact support if this persists.",
        });
      } catch (err) {
        console.error("[analyze-book] failed to record failure on job", jobId, err);
      }
    },
  },
  async ({ event, step }) => {
    const { bookId, jobId } = event.data;
    const runner: StepRunner = async (name, fn) =>
      (await step.run(name, fn)) as Awaited<ReturnType<typeof fn>>;
    await runAnalysis(bookId, jobId, runner);
  },
);
