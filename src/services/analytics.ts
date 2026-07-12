/**
 * Analytics query layer — thin, no route/auth logic (callers do the
 * auth/admin gating; see CLAUDE.md "Route handlers are thin"). Backs the
 * reader-stats dashboard, per-book stats strip, the gamified Codex, and the
 * admin metrics view (docs/analytics-plan.md, Tiers 1/2/3).
 *
 * SPOILER SAFETY: every function that touches world content (entities,
 * overlays) is frontier-gated using the exact pattern in
 * src/services/world.ts getWorldForReader — look up readingProgress's
 * frontierChunk (default 0 when the reader has no progress row yet), null
 * only for an explicit owner/admin full view, and fail CLOSED on unknown
 * introduction points. getAdminMetrics is aggregate-only and never returns
 * per-entity/per-user world content.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, dbReady } from "@/db";
import {
  books,
  chatMessages,
  chatSessions,
  entities,
  images,
  overlays,
  readingActivity,
  readingProgress,
  usageEvents,
  worldReferences,
} from "@/db/schema";
import {
  cardState,
  prominenceScore,
  rarityFromScore,
  type Rarity,
} from "@/domain/codex";
import { pageToChunkIdx } from "@/domain/schemas";
import { addUtcDays, computeStreaks, utcDayString } from "@/domain/streak";
import { storage } from "@/services/storage";

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function activeIdsOf(row: { activeEntityIds: unknown }): string[] {
  return Array.isArray(row.activeEntityIds)
    ? (row.activeEntityIds as string[])
    : [];
}

// ---------------------------------------------------------------------------
// getReaderStats — across every book the caller has ever opened
// ---------------------------------------------------------------------------

export interface MostChattedCharacter {
  bookId: string;
  entityId: string;
  name: string;
  messageCount: number;
}

export interface ReaderStatsDto {
  booksStarted: number;
  booksFinished: number;
  booksInProgress: number;
  /** Frontier-based: sum of (min(frontierChunk+1, totalChunks)) across books. */
  totalPagesRead: number;
  /** Frontier-based estimate: pages-read fraction × the book's totalWords. */
  totalWordsRead: number;
  /** Distinct (bookId, entityId) pairs introduced at/behind that book's frontier. */
  castMet: number;
  mostChattedCharacter: MostChattedCharacter | null;
  /** Consecutive days (ending today or yesterday) with a progress update. */
  readingStreakDays: number;
}

/** Walks a DESC list of UTC calendar days and counts the current streak. */
function computeStreakDays(daysDesc: Date[]): number {
  if (daysDesc.length === 0) return 0;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  const today = startOfUtcDay(new Date());
  const mostRecent = startOfUtcDay(daysDesc[0]);
  const gapFromToday = Math.round(
    (today.getTime() - mostRecent.getTime()) / ONE_DAY_MS,
  );
  // No progress today AND none yesterday -> the streak has lapsed.
  if (gapFromToday > 1) return 0;

  let streak = 1;
  for (let i = 1; i < daysDesc.length; i++) {
    const prev = startOfUtcDay(daysDesc[i - 1]);
    const curr = startOfUtcDay(daysDesc[i]);
    const gap = Math.round((prev.getTime() - curr.getTime()) / ONE_DAY_MS);
    if (gap === 1) streak += 1;
    else break;
  }
  return streak;
}

/**
 * Cross-book reader stats for the shelf's "Your Reading" dashboard. All
 * aggregates run as a small, fixed number of SQL queries (no per-book
 * fan-out loop) regardless of how many books the caller has read.
 */
export async function getReaderStats(userId: string): Promise<ReaderStatsDto> {
  await dbReady;

  // Books started/finished + frontier-based pages/words read, in one
  // aggregate query over the caller's progress rows joined to book length.
  const [progressAgg] = await db
    .select({
      booksStarted: sql<number>`count(*)::int`,
      booksFinished: sql<number>`count(*) filter (
        where ${books.totalChunks} is not null
          and ${readingProgress.frontierChunk} >= ${books.totalChunks} - 1
      )::int`,
      totalPagesRead: sql<number>`coalesce(sum(
        least(${readingProgress.frontierChunk} + 1, coalesce(${books.totalChunks}, ${readingProgress.frontierChunk} + 1))
      ), 0)::int`,
      totalWordsRead: sql<number>`coalesce(sum(
        case when ${books.totalChunks} > 0 and ${books.totalWords} is not null
          then (least(${readingProgress.frontierChunk} + 1, ${books.totalChunks})::float / ${books.totalChunks}) * ${books.totalWords}
          else 0 end
      ), 0)::int`,
    })
    .from(readingProgress)
    .innerJoin(books, eq(books.id, readingProgress.bookId))
    .where(eq(readingProgress.userId, userId));

  // Distinct cast met across every book: an entity counts once it's
  // introduced at/behind THAT book's frontier — joined per-row, not looped.
  const [castRow] = await db
    .select({
      castMet: sql<number>`count(distinct (${entities.bookId}::text || ':' || ${entities.id}))::int`,
    })
    .from(entities)
    .innerJoin(
      readingProgress,
      and(
        eq(readingProgress.bookId, entities.bookId),
        eq(readingProgress.userId, userId),
      ),
    )
    .where(
      and(
        sql`${entities.introducedAtChunk} is not null`,
        lte(entities.introducedAtChunk, readingProgress.frontierChunk),
      ),
    );

  // Most-chatted character (by message count) across all books.
  const [topChat] = await db
    .select({
      bookId: chatSessions.bookId,
      entityId: chatSessions.entityId,
      name: entities.name,
      messageCount: sql<number>`count(*)::int`,
    })
    .from(chatMessages)
    .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
    .innerJoin(
      entities,
      and(
        eq(entities.bookId, chatSessions.bookId),
        eq(entities.id, chatSessions.entityId),
      ),
    )
    .where(eq(chatSessions.userId, userId))
    .groupBy(chatSessions.bookId, chatSessions.entityId, entities.name)
    .orderBy(desc(sql`count(*)`))
    .limit(1);

  // Reading streak from the cadence of progress updates (see
  // docs/analytics-plan.md "reading time" gap — this is the approximation).
  const dayRows = await db
    .select({
      day: sql<string>`date_trunc('day', ${readingProgress.updatedAt})::date`,
    })
    .from(readingProgress)
    .where(eq(readingProgress.userId, userId))
    .groupBy(sql`date_trunc('day', ${readingProgress.updatedAt})`)
    .orderBy(desc(sql`date_trunc('day', ${readingProgress.updatedAt})`));
  const readingStreakDays = computeStreakDays(
    dayRows.map((r) => new Date(r.day)),
  );

  const booksStarted = progressAgg?.booksStarted ?? 0;
  const booksFinished = progressAgg?.booksFinished ?? 0;

  return {
    booksStarted,
    booksFinished,
    booksInProgress: Math.max(0, booksStarted - booksFinished),
    totalPagesRead: progressAgg?.totalPagesRead ?? 0,
    totalWordsRead: progressAgg?.totalWordsRead ?? 0,
    castMet: castRow?.castMet ?? 0,
    mostChattedCharacter: topChat
      ? {
          bookId: topChat.bookId,
          entityId: topChat.entityId,
          name: topChat.name,
          messageCount: topChat.messageCount,
        }
      : null,
    readingStreakDays,
  };
}

// ---------------------------------------------------------------------------
// getBookStats — one book, for the caller
// ---------------------------------------------------------------------------

// Rough average adult silent-reading pace, used only for a ballpark
// time-to-finish estimate until real dwell-time instrumentation exists (see
// docs/analytics-plan.md's "reading time" gap).
const ASSUMED_WORDS_PER_MINUTE = 200;

export interface BookStatsDto {
  /** min(frontierChunk+1, totalChunks) / totalChunks, as a whole percent. */
  progressPercent: number;
  /** 1-based furthest page the reader has reached (their frontier). */
  furthestPage: number;
  castMet: number;
  castTotal: number;
  scenesUnlocked: number;
  /** User-authored chat messages sent to any character in this book. */
  chatMessagesSent: number;
  /** null when the book has no known word count. */
  estMinutesToFinish: number | null;
}

/**
 * Per-book stats strip: progress, cast met vs total (frontier-gated), scenes
 * unlocked, chat activity, and a rough time-to-finish. A fixed handful of
 * queries regardless of book length.
 */
export async function getBookStats(
  userId: string,
  bookId: string,
): Promise<BookStatsDto> {
  await dbReady;

  const [book] = await db
    .select({ totalChunks: books.totalChunks, totalWords: books.totalWords })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);
  const totalChunks = book?.totalChunks ?? 0;
  const totalWords = book?.totalWords ?? 0;

  const [progress] = await db
    .select({ frontierChunk: readingProgress.frontierChunk })
    .from(readingProgress)
    .where(
      and(
        eq(readingProgress.userId, userId),
        eq(readingProgress.bookId, bookId),
      ),
    )
    .limit(1);
  const frontierChunk = progress?.frontierChunk ?? 0;

  const pagesRead =
    totalChunks > 0
      ? Math.min(frontierChunk + 1, totalChunks)
      : frontierChunk + 1;
  const progressPercent =
    totalChunks > 0 ? Math.round((pagesRead / totalChunks) * 100) : 0;

  const [castRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      met: sql<number>`count(*) filter (
        where ${entities.introducedAtChunk} is not null
          and ${entities.introducedAtChunk} <= ${frontierChunk}
      )::int`,
    })
    .from(entities)
    .where(eq(entities.bookId, bookId));

  const [scenesRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(overlays)
    .where(
      and(
        eq(overlays.bookId, bookId),
        eq(overlays.status, "ready"),
        lte(overlays.chunkIdx, frontierChunk),
      ),
    );

  const [chatRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(chatMessages)
    .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.bookId, bookId),
        eq(chatMessages.role, "user"),
      ),
    );

  const wordsRead =
    totalChunks > 0 && totalWords
      ? Math.round((pagesRead / totalChunks) * totalWords)
      : 0;
  const wordsRemaining = Math.max(0, totalWords - wordsRead);
  const estMinutesToFinish =
    totalWords > 0
      ? Math.round(wordsRemaining / ASSUMED_WORDS_PER_MINUTE)
      : null;

  return {
    progressPercent,
    furthestPage: frontierChunk + 1,
    castMet: castRow?.met ?? 0,
    castTotal: castRow?.total ?? 0,
    scenesUnlocked: scenesRow?.n ?? 0,
    chatMessagesSent: chatRow?.n ?? 0,
    estMinutesToFinish,
  };
}

// ---------------------------------------------------------------------------
// getCodexForBook — the gamified card collection
// ---------------------------------------------------------------------------

export interface CodexCardLocked {
  state: "locked";
  /** Safe to expose: doesn't identify WHICH entity, just its category. */
  kind: string;
  /** Stable position in a fixed grid layout — not derived from story order. */
  slot: number;
}

export interface CodexCardRevealed {
  state: "met" | "known";
  id: string;
  name: string;
  kind: string;
  rarity: Rarity;
  portraitUrl: string | null;
  /**
   * True when this entity has been met (met/known) but the illustration
   * pipeline hasn't produced a portrait for it yet — a THIRD visual state,
   * distinct from both 'locked' (silhouette) and a fully-revealed portrait:
   * name/rarity are already safe to show, the art just hasn't arrived. Never
   * inferred client-side from `portraitUrl === null` — always read this flag.
   */
  illustrationPending: boolean;
  slot: number;
}

export type CodexCard = CodexCardLocked | CodexCardRevealed;

export interface CodexDto {
  cards: CodexCard[];
  counts: Record<string, { met: number; total: number }>;
}

export interface GetCodexOptions {
  userId: string;
  bookId: string;
  /** Owner/admin full view: every card is 'known', no frontier lookup. */
  isOwnerOrAdmin?: boolean;
}

/**
 * Builds the Codex card grid for a book, one card per entity, gated by the
 * reader's frontier via the SAME fail-closed rule as getWorldForReader
 * (src/services/world.ts): unknown or ahead-of-frontier introductions are
 * 'locked'. A locked card carries only its `kind` and grid `slot` — no id,
 * name, rarity, or portrait ever leaves this function for it.
 *
 * Batches all the "screen time" ingredients (pageCount, co-occurrence for
 * relationshipDegree, chat count, portrait image) in a fixed number of
 * queries — one entity-row scan, one frontier-bounded overlay scan, one
 * grouped chat-count query, one batch image lookup — never one query per
 * entity.
 */
export async function getCodexForBook(
  opts: GetCodexOptions,
): Promise<CodexDto> {
  await dbReady;

  const [book] = await db
    .select({ totalChunks: books.totalChunks })
    .from(books)
    .where(eq(books.id, opts.bookId))
    .limit(1);
  const totalChunks = book?.totalChunks ?? 0;

  let frontierChunk: number | null = null;
  if (!opts.isOwnerOrAdmin) {
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

  // Deterministic, content-independent ordering (id is a stable slug) so a
  // card's grid `slot` doesn't shuffle between calls.
  const entityRows = await db
    .select()
    .from(entities)
    .where(eq(entities.bookId, opts.bookId))
    .orderBy(asc(entities.id));

  // One frontier-bounded overlay scan feeds pageCount + co-occurrence +
  // portrait lookup for every entity at once.
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
    })
    .from(overlays)
    .where(and(...overlayConds))
    .orderBy(asc(overlays.chunkIdx));

  const pageCountByEntity = new Map<string, number>();
  const coOccurByEntity = new Map<string, Set<string>>();
  const firstImageByEntity = new Map<string, string>();
  for (const row of overlayRows) {
    const ids = activeIdsOf(row);
    for (const id of ids) {
      pageCountByEntity.set(id, (pageCountByEntity.get(id) ?? 0) + 1);
      if (row.imageId && !firstImageByEntity.has(id)) {
        firstImageByEntity.set(id, row.imageId);
      }
      let set = coOccurByEntity.get(id);
      if (!set) {
        set = new Set();
        coOccurByEntity.set(id, set);
      }
      for (const other of ids) {
        if (other !== id) set.add(other);
      }
    }
  }

  // Batch chat-message counts for the whole book, grouped by entity.
  const chatRows = await db
    .select({
      entityId: chatSessions.entityId,
      n: sql<number>`count(*)::int`,
    })
    .from(chatMessages)
    .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
    .where(
      and(
        eq(chatSessions.userId, opts.userId),
        eq(chatSessions.bookId, opts.bookId),
      ),
    )
    .groupBy(chatSessions.entityId);
  const chatCountByEntity = new Map(chatRows.map((r) => [r.entityId, r.n]));

  // Batch portrait lookup for every distinct illustrated scene referenced —
  // bounded by cast size, not by book length.
  const imageIds = [...new Set(firstImageByEntity.values())];
  const imageRows = imageIds.length
    ? await db
        .select({ id: images.id, storageKey: images.storageKey })
        .from(images)
        .where(inArray(images.id, imageIds))
    : [];
  const portraitUrlByImageId = new Map<string, string>();
  await Promise.all(
    imageRows.map(async (r) => {
      portraitUrlByImageId.set(r.id, await storage.getUrl(r.storageKey));
    }),
  );

  const counts: Record<string, { met: number; total: number }> = {};
  const cards: CodexCard[] = [];

  entityRows.forEach((e, slot) => {
    const bucket = (counts[e.kind] ??= { met: 0, total: 0 });
    bucket.total += 1;

    const state = cardState(e.introducedAtChunk, frontierChunk);
    if (state === "locked") {
      cards.push({ state: "locked", kind: e.kind, slot });
      return;
    }

    bucket.met += 1;

    const pageCount = pageCountByEntity.get(e.id) ?? 0;
    const relationshipDegree = coOccurByEntity.get(e.id)?.size ?? 0;
    const chatCount = chatCountByEntity.get(e.id) ?? 0;
    const score = prominenceScore({
      pageCount,
      relationshipDegree,
      chatCount,
      totalChunks,
    });
    const rarity = rarityFromScore(score);
    const imageId = firstImageByEntity.get(e.id);
    const portraitUrl = imageId
      ? (portraitUrlByImageId.get(imageId) ?? null)
      : null;

    cards.push({
      state,
      id: e.id,
      name: e.name,
      kind: e.kind,
      rarity,
      portraitUrl,
      illustrationPending: portraitUrl === null,
      slot,
    });
  });

  return { cards, counts };
}

// ---------------------------------------------------------------------------
// getAdminMetrics — cross-user aggregates for the admin "Press Room"
// ---------------------------------------------------------------------------

// Google AI Studio free-tier daily request cap (see CLAUDE.md ZERO-COST
// CONSTRAINT) — the denominator for the free-tier headroom estimate below.
const GEMINI_FREE_TIER_RPD = 1500;

export interface CostByBookDay {
  bookId: string | null;
  day: string;
  costUsd: number;
  tokens: number;
}

export interface AdminMetricsDto {
  costByBookDay: CostByBookDay[];
  totalSpendUsd: number;
  /** Distinct (user, book) reading pairs on analyzed books ÷ analyzed books. */
  amortizationRatio: number;
  freeTier: {
    requestsToday: number;
    dailyLimit: number;
    headroomPct: number;
  };
  engagement: {
    booksOpened: number;
    chatMessagesTotal: number;
    completionRatePct: number;
  };
}

/**
 * Cross-user aggregate metrics for the admin dashboard: LLM cost per
 * book/day, the amortization ratio (readers per analyzed book — the core
 * unit economic under the zero-cost model), free-tier request headroom, and
 * basic engagement/completion. No per-user or per-entity data is returned;
 * this function does NOT check the caller's role — the route admin-gates it
 * (see CLAUDE.md "Route handlers are thin").
 */
export async function getAdminMetrics(): Promise<AdminMetricsDto> {
  await dbReady;

  const costByBookDay = await db
    .select({
      bookId: usageEvents.bookId,
      day: sql<string>`date_trunc('day', ${usageEvents.createdAt})::date`,
      costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)::float`,
      tokens: sql<number>`coalesce(sum(
        coalesce(${usageEvents.inputTokens}, 0) + coalesce(${usageEvents.outputTokens}, 0)
      ), 0)::int`,
    })
    .from(usageEvents)
    .groupBy(
      usageEvents.bookId,
      sql`date_trunc('day', ${usageEvents.createdAt})`,
    )
    .orderBy(desc(sql`date_trunc('day', ${usageEvents.createdAt})`));

  const [{ totalSpendUsd }] = await db
    .select({
      totalSpendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)::float`,
    })
    .from(usageEvents);

  const [{ analyzedBooks }] = await db
    .select({ analyzedBooks: sql<number>`count(*)::int` })
    .from(worldReferences)
    .where(eq(worldReferences.status, "completed"));

  const [{ readerBookPairs }] = await db
    .select({
      readerBookPairs: sql<number>`count(distinct (
        ${readingProgress.userId} || ':' || ${readingProgress.bookId}::text
      ))::int`,
    })
    .from(readingProgress)
    .innerJoin(
      worldReferences,
      eq(worldReferences.bookId, readingProgress.bookId),
    )
    .where(eq(worldReferences.status, "completed"));

  const amortizationRatio =
    analyzedBooks > 0 ? readerBookPairs / analyzedBooks : 0;

  const todayStart = startOfUtcDay(new Date());
  const [{ requestsToday }] = await db
    .select({ requestsToday: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, todayStart));
  const headroomPct = Math.max(
    0,
    Math.round(
      ((GEMINI_FREE_TIER_RPD - requestsToday) / GEMINI_FREE_TIER_RPD) * 100,
    ),
  );

  const [{ booksOpened }] = await db
    .select({ booksOpened: sql<number>`count(*)::int` })
    .from(readingProgress);

  const [{ chatMessagesTotal }] = await db
    .select({ chatMessagesTotal: sql<number>`count(*)::int` })
    .from(chatMessages);

  const [{ startedCount, finishedCount }] = await db
    .select({
      startedCount: sql<number>`count(*)::int`,
      finishedCount: sql<number>`count(*) filter (
        where ${books.totalChunks} is not null
          and ${readingProgress.frontierChunk} >= ${books.totalChunks} - 1
      )::int`,
    })
    .from(readingProgress)
    .innerJoin(books, eq(books.id, readingProgress.bookId));

  const completionRatePct =
    startedCount > 0 ? Math.round((finishedCount / startedCount) * 100) : 0;

  return {
    costByBookDay,
    totalSpendUsd,
    amortizationRatio,
    freeTier: {
      requestsToday,
      dailyLimit: GEMINI_FREE_TIER_RPD,
      headroomPct,
    },
    engagement: {
      booksOpened,
      chatMessagesTotal,
      completionRatePct,
    },
  };
}

// ---------------------------------------------------------------------------
// getStoryInsights — Tier 2 story-world insights (character network,
// screen-time, and a frontier-filtered timeline spine) for one book
// ---------------------------------------------------------------------------

/** Shape of one `world_references.timeline` entry (see TimelineEntrySchema). */
interface StoryTimelineItem {
  label?: unknown;
  summary?: unknown;
  approxPage?: number | null;
  [key: string]: unknown;
}

export interface StoryInsightNode {
  id: string;
  name: string;
  kind: string;
  /** Overlays (pages), within the reader's frontier, this entity is active on. */
  pageCount: number;
  /** First illustrated (ready) scene featuring this entity, or null when none
   * exists yet within the frontier — the UI falls back to an initial-letter
   * plate rather than an empty dot. */
  portraitUrl: string | null;
  /** Up to a few frontier-safe timeline event labels this entity is tied to
   * (via co-occurrence on the event's page) — ties the network graph to the
   * story's key moments without a spoiler-risk lookup of its own. */
  keyEvents: string[];
}

export interface StoryInsightEdge {
  source: string;
  target: string;
  /** Number of pages the two entities share a scene on. */
  weight: number;
}

export interface StoryInsightTimelineEntry {
  label: string;
  summary: string;
  /** 1-based page, as emitted by synthesis; null only in an owner/admin full
   * view for a legacy entry that never got one. */
  approxPage: number | null;
  /** Entities active on this event's page — already frontier-filtered (same
   * `revealed` set as the network), so every id here is safe to link/name. */
  entityIds: string[];
}

export interface StoryInsightsDto {
  /** 'completed' | 'none' | 'pending' | 'failed' — mirrors world_references.status. */
  status: string;
  network: { nodes: StoryInsightNode[]; edges: StoryInsightEdge[] };
  /** Same nodes as `network.nodes`, ranked by pageCount desc — ready for a bar list. */
  screenTime: StoryInsightNode[];
  timeline: {
    /** Frontier-filtered entries only — never anything ahead of the reader. */
    entries: StoryInsightTimelineEntry[];
    /** Total events across the whole book's timeline. A count is safe to
     * reveal on its own; the entries' content is what's gated. */
    totalCount: number;
    /** totalCount - entries.length — entries hidden because they're ahead of
     * the frontier OR (fail closed) their position couldn't be determined.
     * Drives an "N events ahead" unlabeled-tick affordance. */
    hiddenAheadCount: number;
    frontierChunk: number | null;
    totalChunks: number | null;
  };
}

export interface GetStoryInsightsOptions {
  userId: string;
  bookId: string;
  /** Owner/admin full view: no frontier gate, every entity/timeline entry visible. */
  isOwnerOrAdmin?: boolean;
}

function emptyStoryInsights(status: string): StoryInsightsDto {
  return {
    status,
    network: { nodes: [], edges: [] },
    screenTime: [],
    timeline: {
      entries: [],
      totalCount: 0,
      hiddenAheadCount: 0,
      frontierChunk: null,
      totalChunks: null,
    },
  };
}

/**
 * Tier-2 story-world insights for one book (docs/analytics-plan.md): a
 * character co-occurrence network (edges from shared `overlays.
 * activeEntityIds`), each entity's "screen time" (page count), and the world
 * reference's timeline filtered to the reader's frontier.
 *
 * SPOILER SAFETY: uses the exact same fail-closed frontier gate as
 * getCodexForBook/getWorldForReader. An entity whose `cardState` (src/domain/
 * codex.ts) is 'locked' — ahead of the reader's frontier, or with an unknown
 * introduction point — is dropped from the `revealed` set BEFORE any node or
 * edge is built, so a locked entity's id, name, or co-occurrence can never
 * leak through the network graph, even if that id appears in an
 * already-read overlay's `activeEntityIds` (e.g. a co-occurring character
 * whose OWN introduction point the pipeline never placed). The timeline
 * reuses getWorldForReader's page->chunk conversion and fails closed on a
 * missing `approxPage`; only a COUNT of hidden-ahead events is ever exposed,
 * never their labels/summaries.
 *
 * Fixed number of queries regardless of book size: one world-reference
 * lookup, one book lookup, one frontier lookup, one entity scan, one
 * frontier-bounded overlay scan — never a query per entity or per overlay.
 */
export async function getStoryInsights(
  opts: GetStoryInsightsOptions,
): Promise<StoryInsightsDto> {
  await dbReady;

  const [world] = await db
    .select({
      status: worldReferences.status,
      timeline: worldReferences.timeline,
    })
    .from(worldReferences)
    .where(eq(worldReferences.bookId, opts.bookId))
    .limit(1);

  if (!world || world.status !== "completed") {
    return emptyStoryInsights(world?.status ?? "none");
  }

  const [book] = await db
    .select({ totalChunks: books.totalChunks })
    .from(books)
    .where(eq(books.id, opts.bookId))
    .limit(1);
  const totalChunks = book?.totalChunks ?? null;

  let frontierChunk: number | null = null;
  if (!opts.isOwnerOrAdmin) {
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
    .where(eq(entities.bookId, opts.bookId))
    .orderBy(asc(entities.id));

  // Locked entities never make it into `revealed` — the same fail-closed
  // rule as the Codex. Everything downstream reads from this map only.
  const revealed = new Map<string, { name: string; kind: string }>();
  for (const e of entityRows) {
    if (cardState(e.introducedAtChunk, frontierChunk) !== "locked") {
      revealed.set(e.id, { name: e.name, kind: e.kind });
    }
  }

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
    })
    .from(overlays)
    .where(and(...overlayConds))
    .orderBy(asc(overlays.chunkIdx));

  const pageCountByEntity = new Map<string, number>();
  const edgeWeights = new Map<string, number>(); // key: "idA idB", idA < idB
  const firstImageByEntity = new Map<string, string>();
  // Which revealed entities are active on a given (already-read) chunk -- lets
  // the frontier-filtered timeline below tie an event to its cast without a
  // second overlay scan or any new LLM-authored linkage.
  const entityIdsByChunk = new Map<number, string[]>();

  for (const row of overlayRows) {
    // Drop any id that isn't in `revealed` -- a locked entity's id must never
    // contribute a node or an edge, even from a page at/behind the frontier.
    const ids = activeIdsOf(row).filter((id) => revealed.has(id));
    entityIdsByChunk.set(row.chunkIdx, ids);
    for (const id of ids) {
      pageCountByEntity.set(id, (pageCountByEntity.get(id) ?? 0) + 1);
      if (row.imageId && !firstImageByEntity.has(id)) {
        firstImageByEntity.set(id, row.imageId);
      }
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const key = `${a} ${b}`;
        edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
      }
    }
  }

  // Batch portrait lookup for every distinct illustrated scene referenced --
  // same pattern as getCodexForBook, bounded by cast size not book length.
  const imageIds = [...new Set(firstImageByEntity.values())];
  const imageRows = imageIds.length
    ? await db
        .select({ id: images.id, storageKey: images.storageKey })
        .from(images)
        .where(inArray(images.id, imageIds))
    : [];
  const portraitUrlByImageId = new Map<string, string>();
  await Promise.all(
    imageRows.map(async (r) => {
      portraitUrlByImageId.set(r.id, await storage.getUrl(r.storageKey));
    }),
  );

  const edges: StoryInsightEdge[] = [...edgeWeights.entries()].map(
    ([key, weight]) => {
      const [source, target] = key.split(" ");
      return { source, target, weight };
    },
  );

  const rawTimeline = Array.isArray(world.timeline)
    ? (world.timeline as StoryTimelineItem[])
    : [];
  const totalCount = rawTimeline.length;
  const timelineEntries: StoryInsightTimelineEntry[] = [];
  for (const item of rawTimeline) {
    const page = typeof item.approxPage === "number" ? item.approxPage : null;
    if (frontierChunk !== null) {
      // Fail CLOSED: an unplaceable or ahead-of-frontier entry is a spoiler
      // risk, exactly like getWorldForReader's timeline filter.
      if (page === null || pageToChunkIdx(page) > frontierChunk) continue;
    }
    // `entityIdsByChunk` was built from the SAME frontier-bounded, revealed-
    // only overlay scan, so an entry's cast list can never include a locked
    // entity even though this loop itself doesn't re-check frontier/reveal.
    const entityIds =
      page !== null ? (entityIdsByChunk.get(pageToChunkIdx(page)) ?? []) : [];
    timelineEntries.push({
      label: typeof item.label === "string" ? item.label : "",
      summary: typeof item.summary === "string" ? item.summary : "",
      approxPage: page,
      entityIds,
    });
  }

  // Reverse index (entity -> event labels), capped small so a node's tooltip
  // stays a hint rather than a second timeline.
  const MAX_KEY_EVENTS_PER_ENTITY = 3;
  const eventLabelsByEntity = new Map<string, string[]>();
  for (const entry of timelineEntries) {
    if (!entry.label) continue;
    for (const id of entry.entityIds) {
      const list = eventLabelsByEntity.get(id) ?? [];
      if (
        list.length < MAX_KEY_EVENTS_PER_ENTITY &&
        !list.includes(entry.label)
      ) {
        list.push(entry.label);
        eventLabelsByEntity.set(id, list);
      }
    }
  }

  const nodes: StoryInsightNode[] = [...revealed.entries()].map(
    ([id, { name, kind }]) => {
      const imageId = firstImageByEntity.get(id);
      return {
        id,
        name,
        kind,
        pageCount: pageCountByEntity.get(id) ?? 0,
        portraitUrl: imageId
          ? (portraitUrlByImageId.get(imageId) ?? null)
          : null,
        keyEvents: eventLabelsByEntity.get(id) ?? [],
      };
    },
  );

  const screenTime = [...nodes].sort((a, b) => b.pageCount - a.pageCount);

  return {
    status: world.status ?? "completed",
    network: { nodes, edges },
    screenTime,
    timeline: {
      entries: timelineEntries,
      totalCount,
      hiddenAheadCount: Math.max(0, totalCount - timelineEntries.length),
      frontierChunk,
      totalChunks,
    },
  };
}

// ---------------------------------------------------------------------------
// getCollectionOverview — per-book completion, for the shelf cross-view
// ---------------------------------------------------------------------------

export interface CollectionOverviewItem {
  bookId: string;
  title: string;
  themeArchetype: string | null;
  castMet: number;
  castTotal: number;
  /** min(frontierChunk+1, totalChunks) / totalChunks, as a whole percent. */
  progressPercent: number;
}

export type CollectionOverviewDto = CollectionOverviewItem[];

/**
 * Per-book completion for every book the caller has opened (has a
 * `readingProgress` row) — the shelf's cross-book collection view: title,
 * theme archetype, cast met/total (frontier-gated, same rule as
 * getBookStats), and overall progress percent. Two fixed queries regardless
 * of shelf size — no per-book fan-out loop.
 */
export async function getCollectionOverview(
  userId: string,
): Promise<CollectionOverviewDto> {
  await dbReady;

  const progressRows = await db
    .select({
      bookId: books.id,
      title: books.title,
      themeArchetype: books.themeArchetype,
      totalChunks: books.totalChunks,
      frontierChunk: readingProgress.frontierChunk,
    })
    .from(readingProgress)
    .innerJoin(books, eq(books.id, readingProgress.bookId))
    .where(eq(readingProgress.userId, userId));

  if (progressRows.length === 0) return [];

  const castRows = await db
    .select({
      bookId: entities.bookId,
      total: sql<number>`count(*)::int`,
      met: sql<number>`count(*) filter (
        where ${entities.introducedAtChunk} is not null
          and ${entities.introducedAtChunk} <= ${readingProgress.frontierChunk}
      )::int`,
    })
    .from(entities)
    .innerJoin(
      readingProgress,
      and(
        eq(readingProgress.bookId, entities.bookId),
        eq(readingProgress.userId, userId),
      ),
    )
    .groupBy(entities.bookId);
  const castByBook = new Map(castRows.map((r) => [r.bookId, r]));

  return progressRows.map((row) => {
    const totalChunks = row.totalChunks ?? 0;
    const frontierChunk = row.frontierChunk ?? 0;
    const pagesRead =
      totalChunks > 0
        ? Math.min(frontierChunk + 1, totalChunks)
        : frontierChunk + 1;
    const progressPercent =
      totalChunks > 0 ? Math.round((pagesRead / totalChunks) * 100) : 0;
    const cast = castByBook.get(row.bookId);

    return {
      bookId: row.bookId,
      title: row.title,
      themeArchetype: row.themeArchetype,
      castMet: cast?.met ?? 0,
      castTotal: cast?.total ?? 0,
      progressPercent,
    };
  });
}

// ---------------------------------------------------------------------------
// getReadingActivity — the contribution-style heatmap + streaks
// ---------------------------------------------------------------------------

/** Weeks shown in the GitHub-contribution-style heatmap grid. */
const HEATMAP_WEEKS = 53;

export interface ReadingActivityDay {
  /** UTC calendar day, 'YYYY-MM-DD'. */
  day: string;
  wordsRead: number;
}

export interface ReadingActivityDto {
  /** The last ~53 weeks (371 days), oldest first, gap-filled with
   * wordsRead: 0 for any day with no activity — ready to lay out as a
   * 53-week x 7-day grid with no client-side date math beyond weekday
   * alignment. */
  days: ReadingActivityDay[];
  /** Consecutive UTC days with activity, ending today or yesterday (see
   * src/domain/streak.ts computeStreaks). */
  currentStreakDays: number;
  /** Longest streak across the caller's ENTIRE activity history, not just
   * the visible 53-week window. */
  longestStreakDays: number;
  /** Distinct active days across the caller's entire history. */
  activeDays: number;
  /** Sum of wordsRead for the current calendar year (always fully covered
   * by the single history query below, since a year is at most 366 days and
   * the window this is drawn from is the caller's whole history). */
  totalWordsThisYear: number;
}

/**
 * The reading heatmap + streak stats for one caller (strictly their own
 * `reading_activity` rows — see src/services/books.ts recordReadingActivity
 * for how rows get written). ONE query fetches the caller's entire activity
 * history (bounded by their own active-day count, not book length or global
 * data), which feeds both the true all-time streak computation and the
 * gap-filled 53-week display window — no per-day query loop.
 */
export async function getReadingActivity(
  userId: string,
): Promise<ReadingActivityDto> {
  await dbReady;

  const rows = await db
    .select({ day: readingActivity.day, wordsRead: readingActivity.wordsRead })
    .from(readingActivity)
    .where(eq(readingActivity.userId, userId))
    .orderBy(asc(readingActivity.day));

  const byDay = new Map(rows.map((r) => [r.day, r.wordsRead ?? 0]));

  const todayIso = utcDayString();
  const startIso = addUtcDays(todayIso, -(HEATMAP_WEEKS * 7 - 1));
  const days: ReadingActivityDay[] = [];
  for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
    const day = addUtcDays(startIso, i);
    days.push({ day, wordsRead: byDay.get(day) ?? 0 });
  }

  const { currentStreakDays, longestStreakDays, activeDays } = computeStreaks(
    rows.map((r) => ({ day: r.day, wordsRead: r.wordsRead ?? 0 })),
    todayIso,
  );

  const yearStartIso = `${new Date().getUTCFullYear()}-01-01`;
  const totalWordsThisYear = rows
    .filter((r) => r.day >= yearStartIso)
    .reduce((sum, r) => sum + (r.wordsRead ?? 0), 0);

  return {
    days,
    currentStreakDays,
    longestStreakDays,
    activeDays,
    totalWordsThisYear,
  };
}
