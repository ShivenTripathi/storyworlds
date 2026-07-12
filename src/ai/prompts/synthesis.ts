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
   - Write attributes.description as a fuller, 2-3 sentence introduction of
     WHO THIS ENTITY IS — the kind of thing a character guide would print:
     their bearing, station, and place in the story as they are FIRST
     introduced. This is read by someone who hasn't met them yet, so it must
     never reveal how their arc resolves, later betrayals/deaths/revelations,
     or anything the text hasn't shown by the point they're introduced.
     attributes.role stays a short one-line tag (e.g. "the Duke's heir");
     description is the paragraph that brings them to life.
   - ALWAYS set introducedAtPage. The notes tag each entity's first sighting
     as "[first seen p.N]" — use the EARLIEST such page across all of the
     entity's name variants. This page is REQUIRED: it drives the spoiler gate
     that decides when a reader is allowed to see this character, so an
     entity with no page is HIDDEN from readers. If no "[first seen p.N]" tag
     is present, infer the earliest page from the part it first appears in.

2. CONSTRUCT A TIMELINE:
   - Produce timeline entries ordered chronologically across the whole book,
     each with a short label, a one/two-sentence summary, and approxPage — the
     page it occurs at. The notes tag events as "[p.N]"; use that. approxPage
     is REQUIRED for the spoiler gate — an event with no page is hidden, so
     always provide your best estimate rather than omitting it.

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

5. WRITE A SPOILER-FREE BLURB:
   - Write "blurb": a back-cover-style teaser, about 40-60 words, in the
     voice of a book jacket — inviting a reader in, not briefing them on the
     plot.
   - This blurb is shown BEFORE anyone has read a single page (on the
     Discover feed and the book's detail page), so it must contain ZERO
     spoilers: no plot resolution, no twists, no reveals, no hint of how the
     story ends or who wins/loses/dies/survives. Describe the premise, the
     central character(s) and situation, and the tone/stakes they're facing
     — stop there. When in doubt, describe LESS of the plot, not more.

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
