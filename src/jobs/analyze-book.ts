import { asc, eq } from "drizzle-orm";
import { completeJson } from "@/ai/client";
import {
  buildSegmentPrompt,
  SEGMENT_SYSTEM_PROMPT,
} from "@/ai/prompts/segment";
import {
  buildSynthesisPrompt,
  SYNTHESIS_SYSTEM_PROMPT,
} from "@/ai/prompts/synthesis";
import { db, dbReady } from "@/db";
import {
  books,
  chunks,
  entities,
  entityAliases,
  jobs,
  worldReferences,
} from "@/db/schema";
import { derivedAliases, normalizeAlias } from "@/domain/entities/resolve";
import {
  dedupeSlug,
  slugifyEntity,
  type EntityKind,
} from "@/domain/entities/slug";
import {
  pageToChunkIdx,
  SegmentAnalysisSchema,
  WorldSynthesisSchema,
  type SegmentAnalysis,
  type WorldSynthesis,
} from "@/domain/schemas";
import { segmentChunks } from "@/domain/segmentation";
import { env } from "@/lib/env";
import { canSpend } from "@/services/quota";
import { generateCoverForBook } from "@/services/cover";
import { generateFunFactsForBook } from "@/services/funfacts";
import { generateOverlayCore } from "@/services/overlays";
import {
  computeSegmentHash,
  computeSynthesisHash,
  getCachedSegment,
  getCachedSynthesis,
  putCachedSegment,
  putCachedSynthesis,
  QuotaPausedError,
} from "@/services/segment-cache";
import { inngest } from "./client";

// ---------------------------------------------------------------------------
// Pipeline core — a plain async function so it can be invoked directly in
// tests/scripts (stepRunner defaults to immediate execution) or wrapped by
// Inngest's `step.run` for durable execution (see analyzeBook below).
// ---------------------------------------------------------------------------

export type StepRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

const defaultStepRunner: StepRunner = (_name, fn) => fn();

const MAX_STORED_STRING = 500;
// Fan-out within ONE analysis. Kept to 2 (not 3) so a single running analysis
// leaves clear room under the 15-request/minute Gemini free-tier cap for
// interactive chat / on-read illustrations (with the global-serialize in
// sweep-analysis ensuring only one analysis runs at a time).
const SEGMENT_CONCURRENCY = 2;

/**
 * Bumped whenever a change to this pipeline (segment/synthesis prompts,
 * schemas, or persistence logic) invalidates data already stored for
 * previously-analyzed books, so the always-on sweeper (src/jobs/sweep-
 * analysis.ts) knows to re-enqueue them for a backfill even though their
 * `world_references.status` is already 'completed'. Persisted into
 * `worldReferences.modelVersions.pipeline` by `persistWorld` below — see
 * `select-analysis-candidate.ts` for how never-analyzed books are still
 * preferred over this kind of stale backfill.
 *
 * Version history:
 *   (unset) -> pre-fix baseline: `buildNotesDigest` dropped per-segment page
 *              anchors, so the synthesis pass had nothing to set
 *              `introducedAtPage`/`approxPage` from and a whole cluster of
 *              entities collapsed onto page 1 (the reported "world panel
 *              shows stuff from page 1" bug).
 *   2       -> `buildNotesDigest` carries "[first seen p.N]" / "[p.N]"
 *              anchors through to the synthesis prompt, which now requires
 *              introducedAtPage/approxPage on every entity/timeline entry.
 */
const PIPELINE_VERSION = 2;

function truncate(
  s: string | undefined,
  max = MAX_STORED_STRING,
): string | undefined {
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
    events: result.events.map((ev) => ({
      ...ev,
      summary: truncate(ev.summary) ?? "",
    })),
    settingNotes: truncate(result.settingNotes),
  };
}

async function updateJob(
  jobId: string,
  patch: Partial<typeof jobs.$inferInsert>,
) {
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
              `- ${e.name} (${e.kind}${e.aliases.length ? `, aka ${e.aliases.join(", ")}` : ""})${e.firstSeenPage != null ? ` [first seen p.${e.firstSeenPage}]` : ""}: ${e.description}`,
          )
          .join("\n") || "(none)";
      const eventLines =
        r.events
          .slice(0, 5)
          .map(
            (ev) =>
              `- ${ev.summary}${ev.page != null ? ` [p.${ev.page}]` : ""}`,
          )
          .join("\n") || "(none)";
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

  // Idempotency for re-analysis (a stale-pipeline-version backfill via the
  // sweeper, or a manual force-retry): entities.id is deterministically
  // minted from the entity's name (slugifyEntity), so re-running analysis
  // over the same book text almost always re-mints the SAME ids for the
  // SAME characters. Without clearing the prior rows first, the insert below
  // would violate the (bookId, id) primary key on entities — or, if the
  // synthesis worded a name slightly differently this time, silently leave a
  // stale duplicate entity/alias set behind alongside the fresh one. Clearing
  // both tables for this book immediately before the fresh insert keeps a
  // (re-)analyzed book at exactly one clean entity/alias set. (entityAliases
  // also FK-cascades off entities, but deleting it explicitly here keeps this
  // idempotency guarantee legible without relying on that cascade.)
  await db.delete(entityAliases).where(eq(entityAliases.bookId, bookId));
  await db.delete(entities).where(eq(entities.bookId, bookId));

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
          e.introducedAtPage !== undefined
            ? pageToChunkIdx(e.introducedAtPage)
            : null,
        attributes: e.attributes,
        visualDescription: e.visualDescription ?? null,
      })),
    );
  }

  // Alias table: normalize every name variant + derived alias; first entity
  // to claim a normalized alias wins, collisions are logged and skipped.
  const claimedAliases = new Set<string>();
  const aliasRows: { bookId: string; aliasNorm: string; entityId: string }[] =
    [];
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

  const modelVersions = {
    segment: env.MODEL_SEGMENT,
    synthesis: env.MODEL_SYNTHESIS,
    pipeline: PIPELINE_VERSION,
  };
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
    .set({
      themeArchetype: synthesis.visualStyle.themeArchetype,
      blurb: synthesis.blurb,
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId));

  // Best-effort cover illustration, now that visualStyle has just been
  // persisted above. generateCoverForBook already degrades to `null` on any
  // image-pipeline failure (see src/ai/image.ts / CLAUDE.md ZERO-COST
  // CONSTRAINT) and never throws — this try/catch is just defense against an
  // unexpected error elsewhere (e.g. a DB hiccup) so a cover problem can
  // never fail the analysis job it rides along with.
  try {
    await generateCoverForBook(bookId);
  } catch (err) {
    console.error(
      `[analyze-book] cover generation failed for book ${bookId}:`,
      err,
    );
  }

  // Best-effort spoiler-free "fun facts" (see src/services/funfacts.ts) —
  // generateFunFactsForBook already catches internally and returns null on
  // any failure; this try/catch is defense in depth so a facts problem can
  // never fail the analysis job it rides along with (see CLAUDE.md ZERO-COST
  // CONSTRAINT + spec: "never block/fail analysis on a facts error").
  try {
    await generateFunFactsForBook(bookId);
  } catch (err) {
    console.error(
      `[analyze-book] fun-facts generation failed for book ${bookId}:`,
      err,
    );
  }
}

/**
 * Core pipeline logic, decoupled from Inngest so it can be exercised
 * directly (e.g. in tests) with the default immediate-execution
 * `stepRunner`. The Inngest-wrapped function below injects `step.run` as the
 * runner for durable, resumable execution.
 */
async function runAnalysis(
  bookId: string,
  jobId: string,
  stepRunner: StepRunner = defaultStepRunner,
): Promise<void> {
  await dbReady;

  const { segments, bookTitle, totalChunks } = await stepRunner(
    "load",
    async () => {
      const [bookRow] = await db
        .select()
        .from(books)
        .where(eq(books.id, bookId))
        .limit(1);
      if (!bookRow) throw new Error("Book not found");

      const chunkRows = await db
        .select({ idx: chunks.idx, text: chunks.text })
        .from(chunks)
        .where(eq(chunks.bookId, bookId))
        .orderBy(asc(chunks.idx));

      const segs = segmentChunks(chunkRows);

      await updateJob(jobId, {
        status: "running",
        stage: "Reading the manuscript…",
        progress: 5,
      });

      return {
        segments: segs,
        bookTitle: bookRow.title,
        totalChunks: chunkRows.length,
      };
    },
  );

  const total = segments.length;
  const segmentResults: SegmentAnalysis[] = new Array(total);
  let done = 0;

  // Content-addressed cache lookup + quota gate (see
  // src/services/segment-cache.ts, src/services/quota.ts): a segment whose
  // text was already analyzed — by THIS book's prior (aborted or stale-
  // pipeline) run, or by any other book that happens to share the text —
  // costs zero fresh LLM calls. Only a genuine cache MISS spends background
  // quota; when that quota is gone, the run aborts cleanly (nothing partial
  // persisted beyond the cache) so a later retry resumes from exactly where
  // this one left off.
  await runWithConcurrency(
    segments,
    SEGMENT_CONCURRENCY,
    async (segment, i) => {
      const hash = computeSegmentHash(segment.text);
      const cached = await getCachedSegment(hash);

      let result: SegmentAnalysis;
      if (cached) {
        result = cached;
      } else {
        if (!(await canSpend("background"))) {
          throw new QuotaPausedError(
            `background quota exhausted before segment ${i + 1}/${total} of "${bookTitle}" — resumes automatically from the segment cache once quota resets`,
          );
        }
        result = await stepRunner(`segment-${i}`, async () => {
          const analysis = await completeJson({
            operation: "segment",
            system: SEGMENT_SYSTEM_PROMPT,
            prompt: buildSegmentPrompt({
              index: segment.index,
              totalSegments: total,
              text: segment.text,
            }),
            schema: SegmentAnalysisSchema,
            bookId,
          });
          const truncated = truncateSegmentAnalysis(analysis);
          await putCachedSegment(hash, truncated);
          return truncated;
        });
      }

      segmentResults[i] = result;
      done += 1;
      await updateJob(jobId, {
        progress: 5 + Math.round(60 * (done / total)),
        stage: `Meeting the characters… (${done}/${total})`,
      });
    },
  );

  await updateJob(jobId, { stage: "Weaving the world…", progress: 70 });

  // Synthesis is whole-book (not segment-shaped), but re-analyzing the exact
  // same notes digest — e.g. a retry after a quota pause that landed right
  // here, with every segment already cached — should skip it too rather than
  // spend a fresh call recomputing an identical result.
  const notesDigest = buildNotesDigest(segmentResults);
  const synthesisHash = computeSynthesisHash({ bookTitle, notesDigest });
  const cachedSynthesis = await getCachedSynthesis(synthesisHash);

  let synthesis: WorldSynthesis;
  if (cachedSynthesis) {
    synthesis = cachedSynthesis;
  } else {
    if (!(await canSpend("background"))) {
      throw new QuotaPausedError(
        `background quota exhausted before synthesizing "${bookTitle}" — resumes automatically (every segment is already cached) once quota resets`,
      );
    }
    synthesis = await stepRunner("synthesize", async () => {
      const result = await completeJson({
        operation: "synthesis",
        system: SYNTHESIS_SYSTEM_PROMPT,
        prompt: buildSynthesisPrompt({
          bookTitle,
          totalSegments: total,
          notesDigest,
        }),
        schema: WorldSynthesisSchema,
        bookId,
      });
      await putCachedSynthesis(synthesisHash, result);
      return result;
    });
  }

  await stepRunner("persist", async () => {
    await persistWorld(bookId, synthesis, segmentResults);
    await updateJob(jobId, {
      progress: 90,
      status: "running",
      stage: "The world is ready.",
    });
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
        // Best-effort AND quota-aware: unlike the segment/synthesis gate
        // above, running out of background quota here just stops warm-start
        // early rather than failing the (already-completed) analysis job —
        // the overlay sweeper (src/jobs/sweep-overlays.ts) drains whatever's
        // left once quota is back.
        if (!(await canSpend("background"))) {
          console.warn(
            `[analyze-book] pausing warm-start overlays for book ${bookId} — background quota exhausted (${idx}/${warmStartCount} done); the overlay sweeper will finish the rest`,
          );
          break;
        }
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

  await updateJob(jobId, {
    progress: 100,
    status: "completed",
    stage: "The world is ready.",
  });
}

// ---------------------------------------------------------------------------
// Inngest wiring
// ---------------------------------------------------------------------------

export const analyzeBook = inngest.createFunction(
  {
    id: "analyze-book",
    // ZERO-COST CONSTRAINT (see CLAUDE.md): keep concurrent Gemini calls low on
    // the free tier. Each run fans out to SEGMENT_CONCURRENCY (2) parallel
    // calls; the DB-level global-serialize in sweep-analysis.ts is the real
    // guarantee that only one analysis runs at a time (Inngest's concurrency:1
    // alone leaked under load — runs release the slot during retry backoff).
    concurrency: 1,
    // Don't burn the scarce daily quota re-retrying a doomed run — the sweeper
    // already retries failed books after a 30-min cooldown (up to 3 attempts).
    retries: 1,
    triggers: [{ event: "book/analyze.requested" }],
    onFailure: async ({ event, error }) => {
      const jobId = (event.data as { event?: { data?: { jobId?: string } } })
        .event?.data?.jobId;
      if (!jobId) return;
      // Record the REAL error (truncated) rather than an opaque generic
      // message — otherwise every failure looks identical and is impossible
      // to diagnose without digging through Inngest/Vercel logs. Still short
      // and prefixed so the reader-facing surface stays civil.
      const detail =
        error instanceof Error ? error.message : String(error ?? "unknown");
      console.error(`[analyze-book] job ${jobId} failed:`, error);
      try {
        await updateJob(jobId, {
          status: "failed",
          error: `Analysis failed: ${detail}`.slice(0, 500),
        });
      } catch (err) {
        console.error(
          "[analyze-book] failed to record failure on job",
          jobId,
          err,
        );
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
