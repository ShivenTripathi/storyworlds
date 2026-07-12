/**
 * Assembles flowing narrative prose out of a handful of short text
 * fragments — used by the character dossier to read as a bio rather than a
 * list of disconnected attribute labels.
 *
 * Pure presentation logic, no db/ai imports: callers are responsible for
 * spoiler safety (e.g. the dossier only ever passes attributes that have
 * already been frontier-reduced — see `reduceAttributes` in
 * src/services/world.ts). This module doesn't know or care about the
 * reader's frontier; it just turns whatever fragments it's given into one
 * paragraph.
 */

/** Ensures a fragment reads as a complete sentence (ends with terminal punctuation). */
function ensureSentence(fragment: string): string {
  const trimmed = fragment.trim();
  if (!trimmed) return trimmed;
  return /[.!?]["')]?$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Joins non-empty fragments into a single flowing paragraph, one sentence
 * per fragment. Falsy/blank fragments are skipped. Returns `null` when
 * nothing was left to assemble, so callers can render nothing rather than
 * an empty paragraph.
 */
export function assembleBio(
  fragments: Array<string | null | undefined>,
): string | null {
  const sentences = fragments
    .filter((f): f is string => Boolean(f && f.trim()))
    .map(ensureSentence);
  return sentences.length > 0 ? sentences.join(" ") : null;
}
