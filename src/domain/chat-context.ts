/**
 * Pure, zero-cost "lookup" logic for character chat context management.
 *
 * The legacy chat prompt stuffed the ENTIRE frontier-visible world reference
 * (every timeline entry) plus the full conversation history into every turn.
 * On the Gemini free tier that's both expensive (tokens) and bad for quality
 * (the model buries the actual question under a wall of context and answers
 * with a monologue). This module replaces the dump with a cheap keyword/entity
 * match: given the reader's message, pick only the slice of the world that is
 * actually relevant to what they asked.
 *
 * Deliberately NOT an embedding search — that would need a paid/hosted model
 * or a vector index, violating the zero-cost constraint. Simple normalized
 * token overlap is free, deterministic, and unit-testable without mocks (this
 * file imports nothing from db/ or ai/).
 */

import { normalizeAlias } from "./entities/resolve";

// Structural types kept local so this domain module imports nothing from ai/
// or db/ (architecture rule). They are intentionally compatible with the
// persona builder's PersonaTimelineItem / ChatHistoryTurn.
export interface TimelineItem {
  label: string;
  summary: string;
  approxPage?: number;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/** A non-self entity the character could plausibly reference, already
 * frontier-gated by the caller (nothing introduced past the reader's
 * frontier ever reaches here). */
export interface EntityCandidate {
  id: string;
  name: string;
  role?: string;
  aliases: string[];
}

export interface RelevantEntity {
  name: string;
  role?: string;
}

export interface RelevantContext {
  entities: RelevantEntity[];
  timeline: TimelineItem[];
}

// Very small stopword set — just enough to stop generic connective words from
// creating spurious timeline "matches". Kept short on purpose; over-filtering
// hurts recall more than a few junk tokens hurt precision.
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "you",
  "your",
  "what",
  "who",
  "how",
  "why",
  "when",
  "where",
  "did",
  "does",
  "was",
  "were",
  "has",
  "have",
  "had",
  "with",
  "that",
  "this",
  "there",
  "they",
  "them",
  "his",
  "her",
  "she",
  "him",
  "about",
  "from",
  "into",
  "out",
  "not",
  "but",
  "all",
  "any",
  "can",
  "will",
  "would",
  "tell",
  "know",
  "think",
  "feel",
  "say",
  "said",
  "like",
  "just",
  "now",
  "get",
]);

const MIN_TOKEN_LEN = 3;

function tokenize(s: string): string[] {
  return normalizeAlias(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
}

/** Tokens including short ones (for name matching, where "R2" / initials
 * matter and stopword filtering is wrong). */
function nameTokens(s: string): string[] {
  return normalizeAlias(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Selects only the world context relevant to the reader's current message.
 *
 *  - Entities: matched when their name (or any alias) appears in the message,
 *    either as a whole normalized substring or via a shared distinctive token.
 *  - Timeline: scored by token overlap with the message, boosted when a
 *    matched entity's name appears in the entry. If nothing matches, falls
 *    back to the most RECENT few entries so the character is never left with
 *    zero grounding (recency ≈ "what's freshest in their mind").
 */
export function selectRelevantContext(opts: {
  message: string;
  candidates: EntityCandidate[];
  timeline: TimelineItem[];
  maxEntities?: number;
  maxTimeline?: number;
}): RelevantContext {
  const maxEntities = opts.maxEntities ?? 4;
  const maxTimeline = opts.maxTimeline ?? 5;

  const messageNorm = normalizeAlias(opts.message);
  const messageTokenSet = new Set(tokenize(opts.message));

  // --- entities ---------------------------------------------------------
  const scoredEntities: { cand: EntityCandidate; score: number }[] = [];
  for (const cand of opts.candidates) {
    const surfaceForms = [cand.name, ...cand.aliases];
    let score = 0;
    for (const form of surfaceForms) {
      const formNorm = normalizeAlias(form);
      if (!formNorm) continue;
      // Whole-name/alias substring is the strongest signal (word-boundary
      // guarded so "ana" doesn't match inside "banana").
      if (
        new RegExp(`(^|\\W)${escapeRegExp(formNorm)}(\\W|$)`, "u").test(
          ` ${messageNorm} `,
        )
      ) {
        score += 10;
        continue;
      }
      // Otherwise a shared distinctive token (e.g. a surname the reader typed
      // without the full name).
      for (const tok of nameTokens(form)) {
        if (tok.length >= MIN_TOKEN_LEN && messageTokenSet.has(tok)) score += 3;
      }
    }
    if (score > 0) scoredEntities.push({ cand, score });
  }
  scoredEntities.sort(
    (a, b) => b.score - a.score || a.cand.name.localeCompare(b.cand.name),
  );
  const relevantEntities = scoredEntities.slice(0, maxEntities);
  const matchedNameTokens = new Set(
    relevantEntities.flatMap((e) => nameTokens(e.cand.name)),
  );

  // --- timeline ---------------------------------------------------------
  const scoredTimeline = opts.timeline.map((item, idx) => {
    const itemTokens = new Set(tokenize(`${item.label} ${item.summary}`));
    let score = 0;
    for (const tok of messageTokenSet) if (itemTokens.has(tok)) score += 1;
    for (const nameTok of matchedNameTokens)
      if (itemTokens.has(nameTok)) score += 2;
    return { item, idx, score };
  });

  let timeline: TimelineItem[];
  const matched = scoredTimeline
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score || b.idx - a.idx);
  if (matched.length > 0) {
    timeline = matched.slice(0, maxTimeline).map((t) => t.item);
  } else {
    // Recency fallback: the last few entries the reader has unlocked.
    timeline = opts.timeline.slice(-Math.min(3, opts.timeline.length));
  }

  return {
    entities: relevantEntities.map((e) => ({
      name: e.cand.name,
      role: e.cand.role,
    })),
    timeline,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cheap, LLM-free "running summary" of conversation turns that fall outside
 * the verbatim window. We deliberately do NOT call the model to summarize —
 * that would add a second billable request per chat turn, defeating the whole
 * point on the free tier. Instead we leave breadcrumbs: how many earlier
 * exchanges happened and what the reader had been asking about, so the
 * character keeps continuity without us re-sending the full transcript.
 */
export function summarizeOlderTurns(
  older: ConversationTurn[],
): string | undefined {
  if (older.length === 0) return undefined;
  const exchanges = Math.ceil(older.length / 2);
  const askedAbout = older
    .filter((t) => t.role === "user")
    .map((t) => t.content.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-4)
    .map((q) => (q.length > 60 ? `${q.slice(0, 60)}…` : q));

  const topics =
    askedAbout.length > 0
      ? ` Earlier they asked about: ${askedAbout.map((q) => `"${q}"`).join("; ")}.`
      : "";

  return `[Continuing an ongoing conversation — ${exchanges} earlier exchange${exchanges === 1 ? "" : "s"} not shown in full.${topics} Don't repeat what you've already covered.]`;
}
