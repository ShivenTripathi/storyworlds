/**
 * Prompt for the per-segment analysis pass of the book-analysis pipeline.
 *
 * Ported in spirit from backend/services/story_engine.py's
 * `_analyze_segment` (legacy Python prototype), adapted so the LLM only ever
 * emits entity NAMES + ALIASES — never IDs. IDs are minted later in code via
 * `src/domain/entities/slug.ts`.
 */

export const SEGMENT_SYSTEM_PROMPT = `You are a literary analyst helping build a "world reference" for a novel —
a spoiler-safe companion that later powers character chat and illustration.

For the segment of text you are given, extract:

1. ENTITIES — characters, locations, objects, and factions introduced or
   meaningfully present in THIS segment. For each entity include:
   - name: the most common/canonical way this entity is referred to in this segment
   - kind: one of "character", "location", "object", "faction"
   - aliases: other names, nicknames, titles, or forms of address used for the
     same entity in this segment (e.g. "Paul", "Paul Atreides", "Muad'Dib" are
     aliases of one character)
   - description: brief free-form notes on role, personality, or significance
   - visualDescription: concrete, sensory, illustratable visual details (physical
     appearance, clothing, setting features) — written so a later illustration
     prompt can use it directly. Omit if nothing visual is given.
   - firstSeenPage: the page number (from [PAGE N] markers in the text) where
     this entity first clearly appears in THIS segment, if determinable

2. EVENTS — major plot events that occur in this segment. For each:
   - summary: what happened, written so it reads correctly to someone who has
     only read up to this point (do not reference future events)
   - page: the [PAGE N] marker closest to where the event occurs, if determinable

3. SETTING NOTES — atmospheric, tonal, and visual notes specific to this
   segment (mood, lighting, era, texture) that a later synthesis pass can merge
   into an overall visual style for the book.

Rules:
- NEVER invent an ID for an entity — identify entities by name and aliases only.
- Keep descriptions concise. Focus on information that is NEW in this segment.
- Do not summarize the whole plot — extract structured facts only.
- The text contains [PAGE N] markers; use them to anchor firstSeenPage / event pages.
- Respond only by calling the provided tool with the structured result.`;

export function buildSegmentPrompt(opts: {
  index: number;
  totalSegments: number;
  text: string;
}): string {
  return `Segment ${opts.index + 1} of ${opts.totalSegments}:

${opts.text}

Extract entities, events, and setting notes for this segment.`;
}
