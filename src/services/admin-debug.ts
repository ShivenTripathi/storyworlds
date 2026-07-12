import { and, asc, desc, eq } from "drizzle-orm";
import { db, dbReady } from "@/db";
import {
  books,
  entities,
  entityAliases,
  images,
  jobs,
  overlays,
  usageEvents,
  worldReferences,
} from "@/db/schema";

/**
 * Admin book-debug service (see CLAUDE.md "ADMIN CONTROL PANE"). This is the
 * PRIVILEGED inspection view — it deliberately performs NO frontier filtering
 * and NO inner-life attribute reduction (unlike src/services/world.ts's
 * reader-facing loaders). It exists so the founder can see exactly what the
 * analysis pipeline produced: entity extraction + alias resolution, how each
 * per-page overlay binds to entities (scene consistency), the world reference,
 * timeline, per-page image/overlay state, and cost.
 *
 * Read-only: no schema changes, no writes. Derived signals (co-occurrence,
 * anomalies, health) are computed in JS from the loaded rows.
 */

export interface DebugBookMeta {
  id: string;
  title: string;
  author: string | null;
  status: string;
  visibility: string | null;
  themeArchetype: string | null;
  totalChunks: number | null;
  imageInterval: number | null;
  ownerId: string | null;
  createdAt: string;
}

export interface DebugWorldReference {
  status: string | null;
  settingDescription: string | null;
  visualStyle: Record<string, unknown> | null;
  timeline: unknown;
  commitments: unknown;
  unknowns: unknown;
  modelVersions: unknown;
  error: string | null;
  updatedAt: string | null;
}

export interface DebugEntity {
  id: string;
  name: string;
  kind: string;
  introducedAtChunk: number | null;
  attributes: Record<string, unknown> | null;
  visualDescription: string | null;
  aliases: string[];
  /** Number of overlays (pages) this entity is bound-active on. */
  activePageCount: number;
  /** Chunk indices where this entity appears in an overlay's activeEntityIds. */
  activeChunks: number[];
  /** Flags: no aliases resolved / no introduction chunk recorded. */
  flags: { noAliases: boolean; noIntroduction: boolean };
}

export interface DebugResolvedEntity {
  id: string;
  /** null when the id is present in an overlay but absent from the cast. */
  name: string | null;
  /** True when the id resolves to no cast entity (a "ghost" binding). */
  ghost: boolean;
}

export interface DebugUnresolvedMention {
  name: string;
  reason: string;
}

export interface DebugOverlay {
  chunkIdx: number;
  status: string | null;
  sceneDescription: string | null;
  activeEntities: DebugResolvedEntity[];
  unresolvedMentions: DebugUnresolvedMention[];
  interpretiveNotes: string | null;
  mood: string | null;
  suggestedQuestions: string[];
  image: {
    id: string;
    model: string | null;
    prompt: string | null;
    storageKey: string;
  } | null;
  /** Raw jsonb passthroughs for the per-row "raw JSON" toggle. */
  raw: {
    activeEntityIds: unknown;
    unresolvedMentions: unknown;
    interpretiveLens: unknown;
    suggestedQuestions: unknown;
  };
}

export interface DebugUsageGroup {
  operation: string | null;
  provider: string | null;
  model: string | null;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface DebugJob {
  id: string;
  kind: string;
  status: string | null;
  progress: number | null;
  stage: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DebugAnomalyLevel = "warn" | "info";

export interface DebugAnomaly {
  level: DebugAnomalyLevel;
  label: string;
  detail: string;
}

export interface DebugHealth {
  totalChunks: number | null;
  overlayCount: number;
  overlayCoverage: number | null; // 0..1 of totalChunks with an overlay row
  imageCount: number;
  expectedImages: number | null; // ceil(totalChunks / imageInterval)
  imageInterval: number | null;
  entityCount: number;
  entitiesWithoutIntroduction: number;
  entitiesWithoutAliases: number;
  overlaysWithUnresolved: number;
  totalUnresolvedMentions: number;
  totalActiveBindings: number;
  unresolvedRate: number | null; // unresolved / (unresolved + resolved active)
  ghostBindingCount: number;
}

export interface BookDebug {
  book: DebugBookMeta;
  world: DebugWorldReference | null;
  entities: DebugEntity[];
  overlays: DebugOverlay[];
  usage: {
    groups: DebugUsageGroup[];
    totals: { events: number; tokens: number; costUsd: number };
  };
  jobs: DebugJob[];
  health: DebugHealth;
  anomalies: DebugAnomaly[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/**
 * Loads the full, unfiltered debug picture for one book, or `null` if the
 * book does not exist. Caller MUST enforce admin access first.
 */
export async function getBookDebug(bookId: string): Promise<BookDebug | null> {
  await dbReady;

  const [book] = await db
    .select()
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  if (!book) return null;

  const [world] = await db
    .select()
    .from(worldReferences)
    .where(eq(worldReferences.bookId, bookId))
    .limit(1);

  const entityRows = await db
    .select()
    .from(entities)
    .where(eq(entities.bookId, bookId));

  const aliasRows = await db
    .select()
    .from(entityAliases)
    .where(eq(entityAliases.bookId, bookId));

  const overlayRows = await db
    .select()
    .from(overlays)
    .where(eq(overlays.bookId, bookId))
    .orderBy(asc(overlays.chunkIdx));

  const imageRows = await db
    .select()
    .from(images)
    .where(eq(images.bookId, bookId));

  const usageRows = await db
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.bookId, bookId));

  const jobRows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.bookId, bookId)))
    .orderBy(desc(jobs.createdAt))
    .limit(20);

  // --- aliases by entity -------------------------------------------------
  const aliasesByEntity = new Map<string, string[]>();
  for (const a of aliasRows) {
    const list = aliasesByEntity.get(a.entityId) ?? [];
    list.push(a.aliasNorm);
    aliasesByEntity.set(a.entityId, list);
  }

  // --- images by id (for overlay binding) --------------------------------
  const imageById = new Map(imageRows.map((im) => [im.id, im]));

  // --- entity name index + active-page accumulation ----------------------
  const nameById = new Map(entityRows.map((e) => [e.id, e.name]));
  const activeChunksByEntity = new Map<string, number[]>();
  const ghostIds = new Set<string>();
  let totalActiveBindings = 0;
  let totalUnresolvedMentions = 0;
  let overlaysWithUnresolved = 0;

  const debugOverlays: DebugOverlay[] = overlayRows.map((row) => {
    const activeIds = asStringArray(row.activeEntityIds);
    const activeEntities: DebugResolvedEntity[] = activeIds.map((id) => {
      const name = nameById.get(id) ?? null;
      if (name === null) ghostIds.add(id);
      else {
        const list = activeChunksByEntity.get(id) ?? [];
        list.push(row.chunkIdx);
        activeChunksByEntity.set(id, list);
      }
      totalActiveBindings += 1;
      return { id, name, ghost: name === null };
    });

    const unresolvedRaw = Array.isArray(row.unresolvedMentions)
      ? (row.unresolvedMentions as unknown[])
      : [];
    const unresolvedMentions: DebugUnresolvedMention[] = unresolvedRaw.map(
      (u) => {
        const rec = asRecord(u);
        return {
          name: typeof rec?.name === "string" ? rec.name : String(u),
          reason: typeof rec?.reason === "string" ? rec.reason : "",
        };
      },
    );
    if (unresolvedMentions.length > 0) overlaysWithUnresolved += 1;
    totalUnresolvedMentions += unresolvedMentions.length;

    const lens = asRecord(row.interpretiveLens);
    const image = row.imageId ? imageById.get(row.imageId) : undefined;

    return {
      chunkIdx: row.chunkIdx,
      status: row.status,
      sceneDescription: row.sceneDescription,
      activeEntities,
      unresolvedMentions,
      interpretiveNotes:
        lens && typeof lens.notes === "string" ? lens.notes : null,
      mood: lens && typeof lens.mood === "string" ? lens.mood : null,
      suggestedQuestions: asStringArray(row.suggestedQuestions),
      image: image
        ? {
            id: image.id,
            model: image.model,
            prompt: image.prompt,
            storageKey: image.storageKey,
          }
        : null,
      raw: {
        activeEntityIds: row.activeEntityIds,
        unresolvedMentions: row.unresolvedMentions,
        interpretiveLens: row.interpretiveLens,
        suggestedQuestions: row.suggestedQuestions,
      },
    };
  });

  // --- entities with derived binding stats -------------------------------
  const debugEntities: DebugEntity[] = entityRows
    .map((e) => {
      const aliases = (aliasesByEntity.get(e.id) ?? []).sort();
      const activeChunks = (activeChunksByEntity.get(e.id) ?? []).sort(
        (a, b) => a - b,
      );
      return {
        id: e.id,
        name: e.name,
        kind: e.kind,
        introducedAtChunk: e.introducedAtChunk,
        attributes: asRecord(e.attributes),
        visualDescription: e.visualDescription,
        aliases,
        activePageCount: activeChunks.length,
        activeChunks,
        flags: {
          noAliases: aliases.length === 0,
          noIntroduction:
            e.introducedAtChunk === null || e.introducedAtChunk === undefined,
        },
      };
    })
    .sort((a, b) => {
      // Introduced order, then name — mirrors reading order.
      const ai = a.introducedAtChunk ?? Number.MAX_SAFE_INTEGER;
      const bi = b.introducedAtChunk ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });

  // --- usage grouped by operation+model ----------------------------------
  const usageMap = new Map<string, DebugUsageGroup>();
  let totalEvents = 0;
  let totalTokens = 0;
  let totalCost = 0;
  for (const u of usageRows) {
    const key = `${u.operation ?? "?"}::${u.provider ?? "?"}::${u.model ?? "?"}`;
    const input = u.inputTokens ?? 0;
    const output = u.outputTokens ?? 0;
    const cost = u.costUsd ? Number(u.costUsd) : 0;
    const g =
      usageMap.get(key) ??
      ({
        operation: u.operation,
        provider: u.provider,
        model: u.model,
        events: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      } satisfies DebugUsageGroup);
    g.events += 1;
    g.inputTokens += input;
    g.outputTokens += output;
    g.costUsd += cost;
    usageMap.set(key, g);
    totalEvents += 1;
    totalTokens += input + output;
    totalCost += cost;
  }
  const usageGroups = Array.from(usageMap.values()).sort(
    (a, b) => b.costUsd - a.costUsd || b.events - a.events,
  );

  // --- health ------------------------------------------------------------
  const totalChunks = book.totalChunks;
  const imageInterval = book.imageInterval;
  const entitiesWithoutIntroduction = debugEntities.filter(
    (e) => e.flags.noIntroduction,
  ).length;
  const entitiesWithoutAliases = debugEntities.filter(
    (e) => e.flags.noAliases,
  ).length;
  const health: DebugHealth = {
    totalChunks,
    overlayCount: debugOverlays.length,
    overlayCoverage:
      totalChunks && totalChunks > 0
        ? debugOverlays.length / totalChunks
        : null,
    imageCount: imageRows.length,
    expectedImages:
      totalChunks && imageInterval && imageInterval > 0
        ? Math.ceil(totalChunks / imageInterval)
        : null,
    imageInterval,
    entityCount: debugEntities.length,
    entitiesWithoutIntroduction,
    entitiesWithoutAliases,
    overlaysWithUnresolved,
    totalUnresolvedMentions,
    totalActiveBindings,
    unresolvedRate:
      totalUnresolvedMentions + totalActiveBindings > 0
        ? totalUnresolvedMentions /
          (totalUnresolvedMentions + totalActiveBindings)
        : null,
    ghostBindingCount: ghostIds.size,
  };

  // --- anomalies ---------------------------------------------------------
  const anomalies: DebugAnomaly[] = [];
  if (ghostIds.size > 0) {
    anomalies.push({
      level: "warn",
      label: "Ghost bindings",
      detail: `${ghostIds.size} entity id(s) appear in overlays but not in the cast: ${Array.from(
        ghostIds,
      )
        .slice(0, 8)
        .join(", ")}`,
    });
  }
  if (health.unresolvedRate !== null && health.unresolvedRate > 0.25) {
    anomalies.push({
      level: "warn",
      label: "High unresolved-mention rate",
      detail: `${Math.round(health.unresolvedRate * 100)}% of overlay mentions could not be resolved to a cast entity.`,
    });
  }
  if (entitiesWithoutIntroduction > 0) {
    anomalies.push({
      level: "info",
      label: "Entities without an introduction chunk",
      detail: `${entitiesWithoutIntroduction} entity(ies) have no introducedAtChunk — they will never be spoiler-gated by frontier.`,
    });
  }
  if (entitiesWithoutAliases > 0) {
    anomalies.push({
      level: "info",
      label: "Entities with no aliases",
      detail: `${entitiesWithoutAliases} entity(ies) resolved to zero aliases — name variants may not bind.`,
    });
  }
  if (
    health.overlayCoverage !== null &&
    health.overlayCoverage < 1 &&
    debugOverlays.length > 0
  ) {
    anomalies.push({
      level: "info",
      label: "Partial overlay coverage",
      detail: `${debugOverlays.length} of ${totalChunks} chunks have an overlay (${Math.round(
        health.overlayCoverage * 100,
      )}%). Overlays are generated on demand as readers advance.`,
    });
  }

  return {
    book: {
      id: book.id,
      title: book.title,
      author: book.author,
      status: book.status,
      visibility: book.visibility,
      themeArchetype: book.themeArchetype,
      totalChunks: book.totalChunks,
      imageInterval: book.imageInterval,
      ownerId: book.ownerId,
      createdAt: book.createdAt.toISOString(),
    },
    world: world
      ? {
          status: world.status,
          settingDescription: world.settingDescription,
          visualStyle: asRecord(world.visualStyle),
          timeline: world.timeline,
          commitments: world.commitments,
          unknowns: world.unknowns,
          modelVersions: world.modelVersions,
          error: world.error,
          updatedAt: world.updatedAt ? world.updatedAt.toISOString() : null,
        }
      : null,
    entities: debugEntities,
    overlays: debugOverlays,
    usage: {
      groups: usageGroups,
      totals: { events: totalEvents, tokens: totalTokens, costUsd: totalCost },
    },
    jobs: jobRows.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      progress: j.progress,
      stage: j.stage,
      error: j.error,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
    })),
    health,
    anomalies,
  };
}
