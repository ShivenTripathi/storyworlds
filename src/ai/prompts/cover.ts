/**
 * Prompt builder for a book's COVER illustration — pure and DB-free so it's
 * directly unit-testable (see src/ai/prompts/__tests__/cover.test.ts). Fed to
 * the same pluggable image driver as page overlays (src/ai/image.ts's
 * `generateSceneImage`), so a cover degrades to no image exactly like an
 * overlay's illustration does when MODEL_IMAGE is 'none'/unavailable.
 *
 * SPOILER SAFETY: unlike an overlay prompt (built from ONE page's text), a
 * cover prompt is built only from the book's title/author and its whole-book
 * `visualStyle` (art style, palette, mood, era/setting) — never entities,
 * events, commitments, or unknowns. This mirrors the brief a real book
 * jacket illustrator gets: the mood and genre of the world, not a scene from
 * the plot.
 */

import { ARCHETYPE_META } from "@/theme/archetypes";

export interface CoverVisualStyle {
  artStyle?: string | null;
  colorPalette?: string | null;
  mood?: string | null;
  eraSetting?: string | null;
}

export interface BuildCoverPromptInput {
  title: string;
  author?: string | null;
  /** From worldReferences.visualStyle (WorldSynthesisSchema.visualStyle). */
  visualStyle?: CoverVisualStyle | null;
  /** books.themeArchetype — used as a genre nudge when visualStyle is thin
   * or the book hasn't finished analysis yet. */
  themeArchetype?: string | null;
}

const GENERIC_STYLE_FALLBACK = "evocative, atmospheric, genre-appropriate";

/**
 * Builds the image-generation prompt for a book's cover. Never throws, never
 * touches the DB — a pure string transform over already-loaded data.
 */
export function buildCoverPrompt(input: BuildCoverPromptInput): string {
  const { title, author, visualStyle, themeArchetype } = input;

  const styleParts = [
    visualStyle?.artStyle,
    visualStyle?.colorPalette,
    visualStyle?.mood,
    visualStyle?.eraSetting,
  ].filter((s): s is string => Boolean(s && s.trim().length > 0));

  // Fall back to the archetype's own atmospheric one-liner (src/theme/
  // archetypes.ts's ARCHETYPE_META) when there's no synthesized visualStyle
  // yet — keeps even a pre-analysis cover attempt evocative rather than
  // generic.
  if (styleParts.length === 0 && themeArchetype) {
    const meta = (ARCHETYPE_META as Record<string, { description: string }>)[
      themeArchetype
    ];
    if (meta) styleParts.push(meta.description);
  }

  const styleLine =
    styleParts.length > 0 ? styleParts.join(", ") : GENERIC_STYLE_FALLBACK;

  const byline = author && author.trim() ? ` by ${author.trim()}` : "";

  return [
    `A gorgeous, professional book cover illustration for "${title}"${byline}.`,
    `Style and mood: ${styleLine}.`,
    "Atmospheric and evocative — convey the world and mood of the book, like the art beneath a real book jacket, NOT a specific scene or plot event.",
    "No characters' faces in close-up, no readable text or lettering, no title, no logos — pure scene-setting illustration.",
    "Painterly, richly detailed, cinematic composition, portrait orientation.",
  ].join(" ");
}
