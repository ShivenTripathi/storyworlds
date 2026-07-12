import { and, desc, eq } from "drizzle-orm";
import { assertBudget } from "@/ai/budget";
import { streamText } from "@/ai/client";
import {
  buildChatPrompt,
  buildPersona,
  type ChatHistoryTurn,
  type ChatMode,
  type PersonaAttributes,
  type PersonaTimelineItem,
} from "@/ai/prompts/chat";
import { db, dbReady } from "@/db";
import {
  chatMessages,
  chatSessions,
  entities,
  entityAliases,
  worldReferences,
} from "@/db/schema";
import {
  type EntityCandidate,
  selectRelevantContext,
  summarizeOlderTurns,
} from "@/domain/chat-context";
import { frontierFilter } from "@/domain/knowledge";
import { pageToChunkIdx } from "@/domain/schemas";
import { ApiError } from "@/lib/errors";
import { getBook, getChunk, getProgress } from "@/services/books";

export type { ChatMode };

// A reader who has spent roughly this many chunks with a character since
// their introduction is assumed to know their "inner shape" — internal
// state, motivation, scars — even though the omniscient world reference
// already has that detail from page one. This is a heuristic, not a fact
// derived from the text; it exists purely to avoid handing a reader a
// character's full psychological profile the moment they're introduced,
// which was the legacy spoiler leak this module fixes.
const INNER_LIFE_REVEAL_BUFFER_CHUNKS = 20;

// after_ending chat requires the reader be within this many chunks of the
// end of the book, or an explicit client acknowledgement of spoilers.
const ENDING_PROXIMITY_BUFFER_CHUNKS = 5;

// Only the last VERBATIM_TURNS turns are sent to the model word-for-word.
// Earlier turns (up to HISTORY_FETCH_ROWS back) are compressed into a cheap,
// LLM-free breadcrumb note (see summarizeOlderTurns) rather than dumped in
// full. This is the core "don't carry forward all context" change: the prompt
// grows with the RECENT conversation, not the entire session.
const VERBATIM_TURNS = 8;
const VERBATIM_MSG_LIMIT = VERBATIM_TURNS * 2; // user+assistant per turn
// Wider window we read from the DB to build the older-turns summary. Bounded
// so a very long session never turns into an unbounded query/prompt.
const HISTORY_FETCH_ROWS = 60;

// Hard cap on chat reply length. Combined with the "be concise" persona
// guidance, this is what stops the 200-word monologues — and keeps output
// tokens (and Gemini free-tier quota) down.
const CHAT_MAX_TOKENS = 500;

// Bounds on how much world context the lookup step injects per turn.
const MAX_RELEVANT_ENTITIES = 4;
const MAX_RELEVANT_TIMELINE = 5;

type EntityRow = typeof entities.$inferSelect;
type ChatSessionRow = typeof chatSessions.$inferSelect;
type ChatMessageRow = typeof chatMessages.$inferSelect;

interface RawTimelineItem {
  label: string;
  summary: string;
  approxPage?: number;
}

export interface EntityKnowledge {
  attributes: PersonaAttributes;
  visibleTimeline: PersonaTimelineItem[];
}

/**
 * Computes exactly what a character persona is allowed to know for a given
 * reader, mode, and frontier.
 *
 * after_ending: full entity attributes + full timeline — the reader has
 * finished (or explicitly acknowledged spoilers for) the whole book.
 *
 * story_so_far: this is the spoiler-safety-critical path.
 *  - Timeline entries are dropped if their `approxPage` maps to a chunk past
 *    the reader's frontier (same "no page = always safe" convention as
 *    `domain/knowledge.ts`'s `frontierFilter`).
 *  - Attributes are reduced to `role` only, UNLESS the entity has a known
 *    `introducedAtChunk` AND the reader's frontier is at least
 *    `introducedAtChunk + INNER_LIFE_REVEAL_BUFFER_CHUNKS` chunks past it —
 *    only then is internalState/keyMotivation/scars included. This is the
 *    fix for the legacy bug: the old engine always sent the full
 *    (internal_state, key_motivation, scars) block regardless of reader
 *    progress.
 */
export async function getKnowledge(
  bookId: string,
  entityId: string,
  frontierChunk: number,
  mode: ChatMode,
): Promise<EntityKnowledge> {
  await dbReady;

  const entity = await getEntity(bookId, entityId);
  if (!entity) {
    throw new ApiError(404, "not_found", "Character not found.");
  }

  const [world] = await db
    .select({ timeline: worldReferences.timeline })
    .from(worldReferences)
    .where(eq(worldReferences.bookId, bookId))
    .limit(1);

  const rawTimeline = Array.isArray(world?.timeline)
    ? (world.timeline as RawTimelineItem[])
    : [];

  const attributes = (entity.attributes ?? {}) as PersonaAttributes;

  if (mode === "after_ending") {
    return {
      attributes,
      visibleTimeline: rawTimeline.map(toPersonaTimelineItem),
    };
  }

  const visibleTimeline = rawTimeline
    .filter(
      (t) =>
        t.approxPage == null || pageToChunkIdx(t.approxPage) <= frontierChunk,
    )
    .map(toPersonaTimelineItem);

  const canRevealInnerLife =
    entity.introducedAtChunk != null &&
    frontierChunk >= entity.introducedAtChunk + INNER_LIFE_REVEAL_BUFFER_CHUNKS;

  const reducedAttributes: PersonaAttributes = { role: attributes.role };
  if (canRevealInnerLife) {
    reducedAttributes.internalState = attributes.internalState;
    reducedAttributes.keyMotivation = attributes.keyMotivation;
    reducedAttributes.scars = attributes.scars;
  }

  return { attributes: reducedAttributes, visibleTimeline };
}

function toPersonaTimelineItem(t: RawTimelineItem): PersonaTimelineItem {
  return { label: t.label, summary: t.summary, approxPage: t.approxPage };
}

async function getEntity(
  bookId: string,
  entityId: string,
): Promise<EntityRow | undefined> {
  const [row] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.bookId, bookId), eq(entities.id, entityId)))
    .limit(1);
  return row;
}

/**
 * Loads the other entities in a book (excluding `selfId`) as lookup candidates
 * for the relevant-context selector. In story_so_far mode the pool is
 * frontier-gated — an entity introduced past the reader's frontier can never
 * be surfaced — mirroring the timeline gating in getKnowledge. Only name,
 * role, and aliases are carried; inner-life fields are never exposed for
 * OTHER characters.
 */
async function loadEntityCandidates(
  bookId: string,
  selfId: string,
  frontierChunk: number,
  mode: ChatMode,
): Promise<EntityCandidate[]> {
  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      introducedAtChunk: entities.introducedAtChunk,
      attributes: entities.attributes,
    })
    .from(entities)
    .where(eq(entities.bookId, bookId));

  const visible =
    mode === "story_so_far" ? frontierFilter(rows, frontierChunk) : rows;

  const aliasRows = await db
    .select({
      entityId: entityAliases.entityId,
      aliasNorm: entityAliases.aliasNorm,
    })
    .from(entityAliases)
    .where(eq(entityAliases.bookId, bookId));

  const aliasesByEntity = new Map<string, string[]>();
  for (const a of aliasRows) {
    const list = aliasesByEntity.get(a.entityId) ?? [];
    list.push(a.aliasNorm);
    aliasesByEntity.set(a.entityId, list);
  }

  return visible
    .filter((e) => e.id !== selfId)
    .map((e) => ({
      id: e.id,
      name: e.name,
      role: (e.attributes as PersonaAttributes | null)?.role,
      aliases: aliasesByEntity.get(e.id) ?? [],
    }));
}

/**
 * Finds (or creates) the one chat session for a given user/book/character/
 * mode combination — unique on (userId, bookId, entityId, mode).
 */
export async function getOrCreateSession(
  userId: string,
  bookId: string,
  entityId: string,
  mode: ChatMode,
): Promise<ChatSessionRow> {
  await dbReady;

  const [inserted] = await db
    .insert(chatSessions)
    .values({ userId, bookId, entityId, mode })
    .onConflictDoNothing({
      target: [
        chatSessions.userId,
        chatSessions.bookId,
        chatSessions.entityId,
        chatSessions.mode,
      ],
    })
    .returning();
  if (inserted) return inserted;

  const [existing] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.bookId, bookId),
        eq(chatSessions.entityId, entityId),
        eq(chatSessions.mode, mode),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error(
      "getOrCreateSession: failed to create or find chat session",
    );
  }
  return existing;
}

/** Read-only session lookup — unlike `getOrCreateSession`, never creates a
 * row, so a GET (e.g. the history endpoint) can't have the side effect of
 * spinning up a session just by being polled. */
export async function findSession(
  userId: string,
  bookId: string,
  entityId: string,
  mode: ChatMode,
): Promise<ChatSessionRow | undefined> {
  await dbReady;
  const [existing] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.bookId, bookId),
        eq(chatSessions.entityId, entityId),
        eq(chatSessions.mode, mode),
      ),
    )
    .limit(1);
  return existing;
}

export async function appendMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  chunkIdxAtSend: number | null,
): Promise<ChatMessageRow> {
  await dbReady;
  const [row] = await db
    .insert(chatMessages)
    .values({ sessionId, role, content, chunkIdxAtSend })
    .returning();
  return row;
}

/** Chronological (oldest-first) history, most recent `limit` messages. */
export async function getHistory(
  sessionId: string,
  limit = 30,
): Promise<ChatMessageRow[]> {
  await dbReady;
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(desc(chatMessages.id))
    .limit(limit);
  return rows.reverse();
}

export interface StreamChatReplyOptions {
  userId: string;
  bookId: string;
  entityId: string;
  mode: ChatMode;
  message: string;
  chunkIdx: number;
  acknowledgeSpoilers?: boolean;
}

export interface ChatStreamResult {
  sessionId: string;
  userMessageId: number;
  stream: AsyncIterable<string>;
  // Resolves once the full assistant reply has been generated AND persisted.
  assistantMessageId: Promise<number>;
}

/**
 * Validates access + the spoiler gate, persists the user's message, builds a
 * frontier-scoped persona, streams the character's reply, and persists the
 * assistant's message once the stream completes.
 */
export async function streamChatReply(
  opts: StreamChatReplyOptions,
): Promise<ChatStreamResult> {
  const {
    userId,
    bookId,
    entityId,
    mode,
    message,
    chunkIdx,
    acknowledgeSpoilers,
  } = opts;
  await dbReady;

  const entity = await getEntity(bookId, entityId);
  if (!entity) {
    throw new ApiError(404, "not_found", "Character not found.");
  }

  const [book, progress] = await Promise.all([
    getBook(bookId),
    getProgress(userId, bookId),
  ]);
  const frontierChunk = progress?.frontierChunk ?? 0;

  if (mode === "after_ending") {
    const totalChunks = book?.totalChunks ?? null;
    const nearEnding =
      totalChunks != null &&
      frontierChunk >= totalChunks - ENDING_PROXIMITY_BUFFER_CHUNKS;
    if (!nearEnding && !acknowledgeSpoilers) {
      throw new ApiError(
        403,
        "spoiler_gate",
        "You haven't reached the end of the book yet. Confirm you want full-story spoilers to chat in after-ending mode.",
      );
    }
  }

  await assertBudget(bookId);

  const session = await getOrCreateSession(userId, bookId, entityId, mode);
  const userMessage = await appendMessage(
    session.id,
    "user",
    message,
    chunkIdx,
  );

  const knowledge = await getKnowledge(bookId, entityId, frontierChunk, mode);

  // Defensive spoiler clamp: never let the persona read a page past the
  // reader's frontier into its "current scene" context, even if the client
  // sends a stale or manipulated chunkIdx.
  const effectiveChunkIdx =
    mode === "story_so_far" ? Math.min(chunkIdx, frontierChunk) : chunkIdx;
  const chunk = await getChunk(bookId, effectiveChunkIdx);

  const [world] = await db
    .select({ settingDescription: worldReferences.settingDescription })
    .from(worldReferences)
    .where(eq(worldReferences.bookId, bookId))
    .limit(1);

  // Lookup step: pick only the world context relevant to THIS message rather
  // than dumping the whole timeline + full cast every turn. Candidates are
  // frontier-gated (story_so_far never surfaces an entity the reader hasn't
  // met yet) and exclude the character themself.
  const candidates = await loadEntityCandidates(
    bookId,
    entityId,
    frontierChunk,
    mode,
  );
  const relevant = selectRelevantContext({
    message,
    candidates,
    timeline: knowledge.visibleTimeline,
    maxEntities: MAX_RELEVANT_ENTITIES,
    maxTimeline: MAX_RELEVANT_TIMELINE,
  });

  const persona = buildPersona({
    entity: { name: entity.name, visualDescription: entity.visualDescription },
    mode,
    attributes: knowledge.attributes,
    timeline: relevant.timeline,
    relevantEntities: relevant.entities,
    currentPageText: chunk?.text ?? "",
    settingDescription: world?.settingDescription ?? "",
  });

  // Bounded, sessioned history: send only the last VERBATIM_TURNS turns
  // verbatim; compress anything older into a cheap breadcrumb note so we stop
  // re-stuffing the entire conversation into every turn.
  const priorTurns: ChatHistoryTurn[] = (
    await getHistory(session.id, HISTORY_FETCH_ROWS)
  )
    .filter((m) => m.id !== userMessage.id)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));
  const verbatim = priorTurns.slice(-VERBATIM_MSG_LIMIT);
  const older = priorTurns.slice(0, priorTurns.length - verbatim.length);
  const summaryNote = summarizeOlderTurns(older);

  const prompt = buildChatPrompt({ history: verbatim, message, summaryNote });

  const { stream: rawStream, usage } = await streamText({
    operation: "chat",
    system: persona,
    prompt,
    bookId,
    userId,
    maxTokens: CHAT_MAX_TOKENS,
  });

  let resolveAssistantId!: (id: number) => void;
  let rejectAssistantId!: (err: unknown) => void;
  const assistantMessageId = new Promise<number>((resolve, reject) => {
    resolveAssistantId = resolve;
    rejectAssistantId = reject;
  });
  // Attaching a no-op catch here just marks the promise as "handled" for
  // Node's unhandled-rejection detector — the caller still gets the same
  // promise object back and can await/catch it independently (e.g. after
  // fully draining `stream`, once resolveAssistantId/rejectAssistantId has
  // definitely fired).
  assistantMessageId.catch(() => {});

  async function* wrappedStream(): AsyncGenerator<string> {
    let full = "";
    try {
      for await (const delta of rawStream) {
        full += delta;
        yield delta;
      }
      await usage;
      const assistantMessage = await appendMessage(
        session.id,
        "assistant",
        full,
        chunkIdx,
      );
      resolveAssistantId(assistantMessage.id);
    } catch (err) {
      rejectAssistantId(err);
      throw err;
    }
  }

  return {
    sessionId: session.id,
    userMessageId: userMessage.id,
    stream: wrappedStream(),
    assistantMessageId,
  };
}
