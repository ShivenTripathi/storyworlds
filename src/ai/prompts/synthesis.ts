import { ARCHETYPE_META, ARCHETYPES } from "@/theme/archetypes";

/**
 * Prompt for the synthesis pass of the book-analysis pipeline — merges the
 * per-segment notes (see segment.ts) into one canonical world reference.
 *
 * Ported in spirit from backend/services/story_engine.py's
 * `_synthesize_world_reference` (legacy Python prototype), adapted so the
 * LLM only ever emits entity NAMES + ALIASES — never IDs.
 */

const THEME_ARCHETYPE_LINES = ARCHETYPES.map(
  (id) => `     - "${id}": ${ARCHETYPE_META[id].description}`,
).join("\n");

export const SYNTHESIS_SYSTEM_PROMPT = `You are the Lead World Architect. You are given aggregated notes from
sequential segments of a novel (entities, events, and setting notes extracted
segment-by-segment). Synthesize these into ONE cohesive world reference.

1. MERGE ENTITIES:
   - Merge name variants that refer to the same entity into ONE entry. For
     example "Paul" (segment 1) and "Paul Atreides" (segment 3) are the SAME
     character — pick the fullest canonical name and put every variant seen
     (including nicknames, titles, and shortened forms) in that entity's
     aliases list.
   - Combine visual descriptions and attributes (role, internal state, key
     motivation, scars) across all segments the entity appeared in, into one
     consistent picture. Do not contradict earlier segments; later segments
     may add detail.
   - Keep introducedAtPage as the EARLIEST page across all segments where this
     entity (under any of its name variants) appeared.

2. CONSTRUCT A TIMELINE:
   - Produce timeline entries ordered chronologically across the whole book,
     each with a short label, a one/two-sentence summary, and the approximate
     page it occurs at (if determinable from the segment notes).

3. IDENTIFY COMMITMENTS AND UNKNOWNS:
   - Commitments: things the narrative has firmly established as true (facts,
     promises, stated backstory) that a chat agent must not contradict. Mark
     status as "open", "fulfilled", or "broken".
   - Unknowns: open questions or mysteries the text has raised but not yet
     answered — used to keep spoiler-safe chat from guessing ahead.

4. UNIFY VISUAL STYLE:
   - Produce one setting description and one visual style for the whole book:
     artStyle, colorPalette, mood, eraSetting.
   - Choose ONE themeArchetype from this exact list (pick the closest match,
     even if imperfect):
${THEME_ARCHETYPE_LINES}

Rules:
- NEVER invent an ID for an entity — identify entities by name and aliases only.
- Respond only by calling the provided tool with the structured result.`;

export function buildSynthesisPrompt(opts: {
  bookTitle: string;
  totalSegments: number;
  notesDigest: string;
}): string {
  return `Book: "${opts.bookTitle}"
Aggregated analysis notes from ${opts.totalSegments} segments, in order:

${opts.notesDigest}

Synthesize the single canonical world reference for this book.`;
}
