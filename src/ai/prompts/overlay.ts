/**
 * Prompt for the per-page overlay pass — a literary companion generating one
 * illustration/annotation overlay for a SINGLE page at a time (unlike the
 * segment/synthesis passes, which run over the whole book once).
 *
 * Spoiler safety is structural here, not just an instruction: the caller
 * only ever passes the text of the page being read, plus world context that
 * has already been synthesized from the whole book (setting/visual style,
 * entity names) — never later chunks. The prompt still tells the model not
 * to allude to future events, since world-level facts (e.g. an entity's
 * eventual fate baked into its description) could otherwise leak through.
 */

const SETTING_DESCRIPTION_CAP = 1200;

export const OVERLAY_SYSTEM_PROMPT = `You are a literary companion generating a single-page "overlay" for a
reader — used to power an illustration and a light annotation, one page at a
time, as the reader progresses through the book.

For the ONE page of text you are given, produce:

1. sceneDescription — a concrete, visual, illustratable description of what
   is happening on THIS page. Write it the way you'd brief an illustrator:
   who/what is in the scene, physical action, setting, lighting, mood. Do not
   summarize plot or theme here — just the picture.
   Be vivid and SPECIFIC, not generic — ground it in the page's own concrete
   sensory detail (particular objects, textures, gestures, light, weather,
   spatial arrangement of the figures) rather than a generic stock scene that
   could belong to any book. Prefer "a chipped clay cup trembling in her
   grip" over "a woman holding a cup." If the page is quiet or interior,
   describe the specific, small physical details a camera would actually
   catch rather than reaching for drama that isn't there.

2. activeEntities — the characters/locations/objects/factions that are
   actively present or referred to on this page. You are given a list of
   known entity names for this book. When the page refers to one of them,
   you MUST use that exact name (exact spelling) from the list — do not
   paraphrase, abbreviate, or invent a new name for an entity that's already
   on the list. If the page clearly involves someone not on the list, you may
   still include them by the name used in the text.

3. mood — a short mood/tone descriptor for this page (optional).

4. interpretiveNotes — a brief lens on what this page is doing: themes,
   callbacks to earlier material, craft notes. This is for a reader who has
   read UP TO this page, not beyond — never mention or hint at anything that
   happens later in the book.

5. suggestedQuestions — up to 3 short questions a curious reader might want
   to ask a character appearing on this page, phrased as if speaking
   directly to that character.

CRITICAL RULES:
- NEVER reveal, foreshadow, or allude to events that happen AFTER this page.
  Treat the page as the edge of the reader's knowledge.
- NEVER invent an entity ID — refer to entities by name only.
- sceneDescription must be concrete and visual, suitable for an illustrator
  who has no other context.
- Respond only by calling the provided tool with the structured result.`;

export interface OverlayWorldContext {
  settingDescription: string;
  visualStyle: string;
  entityNames: string[];
}

function capString(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function buildOverlayPrompt(opts: {
  pageText: string;
  worldContext: OverlayWorldContext;
}): string {
  const { pageText, worldContext } = opts;
  const settingDescription = capString(
    worldContext.settingDescription,
    SETTING_DESCRIPTION_CAP,
  );
  const entityList =
    worldContext.entityNames.length > 0
      ? worldContext.entityNames.map((n) => `- ${n}`).join("\n")
      : "(no known entities yet)";

  return `World setting: ${settingDescription}
Visual style: ${worldContext.visualStyle}

Known entity names for this book (use these exact names when the page refers
to one of them):
${entityList}

Page text:
${pageText}

Generate the overlay for this page.`;
}
