/**
 * Alias-table based entity name resolution.
 *
 * LLMs emit character/location/object/faction *names* in free text; this
 * module maps those names back to the deterministic entity IDs minted in
 * `slug.ts`. It never invents an ID — it either resolves to a known entity
 * or reports why it couldn't (unknown vs. ambiguous). This is the fix for
 * the legacy system's worst bug class (LLM-invented entity IDs).
 */

/** Sentinel value stored in the alias index when an alias is claimed by 2+ distinct entities. */
export const AMBIGUOUS = Symbol.for("sw.ambiguous");

type AliasIndexValue = string | typeof AMBIGUOUS;

export type AliasIndex = Map<string, AliasIndexValue>;

export interface AliasEntry {
  alias: string;
  entityId: string;
}

const COMBINING_MARKS_RE = /[̀-ͯ]/g;

const HONORIFICS = [
  "dr",
  "mr",
  "mrs",
  "ms",
  "lord",
  "lady",
  "sir",
  "captain",
  "professor",
];

/**
 * Normalize an alias/name for lookup: NFKD-strip diacritics, lowercase,
 * collapse internal whitespace, strip leading/trailing punctuation and a
 * trailing possessive 's.
 */
export function normalizeAlias(s: string): string {
  let out = s.normalize("NFKD").replace(COMBINING_MARKS_RE, "").toLowerCase();

  // Strip a trailing possessive: "baley's" -> "baley", "atreides'" -> "atreides"
  out = out.replace(/['’]s\b/g, "").replace(/['’]\s*$/g, "");

  // Drop abbreviation periods (e.g. "R. Daneel" -> "r daneel") so initials
  // become plain single-letter tokens rather than punctuation-glued noise.
  out = out.replace(/\./g, "");

  // Collapse internal whitespace to single spaces.
  out = out.replace(/\s+/g, " ").trim();

  // Strip leading/trailing punctuation (anything not alphanumeric/space).
  out = out.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");

  return out;
}

/**
 * Build a normalized-alias -> entityId map. When two or more distinct
 * entities claim the same normalized alias, that alias maps to the
 * AMBIGUOUS sentinel instead.
 */
export function buildAliasIndex(entries: AliasEntry[]): AliasIndex {
  const index: AliasIndex = new Map();
  const claimants = new Map<string, Set<string>>();

  for (const { alias, entityId } of entries) {
    const norm = normalizeAlias(alias);
    if (!norm) continue;

    const set = claimants.get(norm) ?? new Set<string>();
    set.add(entityId);
    claimants.set(norm, set);
  }

  for (const [norm, set] of claimants) {
    if (set.size === 1) {
      index.set(norm, [...set][0]);
    } else {
      index.set(norm, AMBIGUOUS);
    }
  }

  return index;
}

export type ResolveResult =
  | { entityId: string }
  | { unresolved: string; reason: "unknown" | "ambiguous" };

function stripHonorific(normName: string): string | null {
  const words = normName.split(" ");
  if (words.length < 2) return null;
  if (HONORIFICS.includes(words[0])) {
    const rest = words.slice(1).join(" ");
    return rest.length > 0 ? rest : null;
  }
  return null;
}

/**
 * Resolve a raw entity name emitted by an LLM against the alias index.
 *
 * Strategy, most to least strict:
 *  1. Exact normalized lookup.
 *  2. Drop a leading honorific (Dr., Mr., Lord, ...) and retry exact lookup.
 *  3. For multi-word names, try containment: find index keys that contain
 *     every word of the name, in order, as a subsequence of words. Resolve
 *     ONLY if exactly one such key exists; if multiple, report ambiguous.
 *  4. Otherwise, unresolved/unknown. Never guesses beyond this.
 */
export function resolveEntityName(
  name: string,
  index: AliasIndex,
): ResolveResult {
  const norm = normalizeAlias(name);
  if (!norm) return { unresolved: name, reason: "unknown" };

  const direct = lookupDirect(norm, index, name);
  if (direct) return direct;

  const withoutHonorific = stripHonorific(norm);
  if (withoutHonorific) {
    const honorificHit = lookupDirect(withoutHonorific, index, name);
    if (honorificHit) return honorificHit;
  }

  const words = norm.split(" ");
  if (words.length >= 2) {
    // Ignore bare single-letter tokens (initials, e.g. the "r" in
    // "r daneel olivaw") when matching against shorter alias keys — they're
    // noise relative to the canonical name, not required containment terms.
    const meaningfulWords = words.filter((w) => w.length > 1);
    const wordsToMatch = meaningfulWords.length >= 2 ? meaningfulWords : words;

    const matches: string[] = [];
    for (const [key, value] of index) {
      if (value === AMBIGUOUS) continue;
      if (keyContainsWordsInOrder(key, wordsToMatch)) {
        matches.push(key);
      }
    }

    if (matches.length === 1) {
      const value = index.get(matches[0]);
      if (typeof value === "string") return { entityId: value };
    } else if (matches.length > 1) {
      return { unresolved: name, reason: "ambiguous" };
    }
  }

  return { unresolved: name, reason: "unknown" };
}

function lookupDirect(
  norm: string,
  index: AliasIndex,
  originalName: string,
): ResolveResult | null {
  if (!index.has(norm)) return null;
  const value = index.get(norm)!;
  if (value === AMBIGUOUS) {
    return { unresolved: originalName, reason: "ambiguous" };
  }
  return { entityId: value };
}

/** True if `key`'s words contain `words` as an in-order subsequence covering all of `words`. */
function keyContainsWordsInOrder(key: string, words: string[]): boolean {
  const keyWords = key.split(" ");
  let i = 0;
  for (const kw of keyWords) {
    if (i < words.length && kw === words[i]) {
      i += 1;
    }
  }
  return i === words.length;
}

/**
 * For a multi-word display name, produce candidate aliases the caller may
 * choose to insert into the alias table: the full name, the last word, and
 * the first word. The caller is responsible for resolving collisions across
 * entities (this function does not consult any existing index).
 */
export function derivedAliases(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];

  const words = trimmed.split(/\s+/);
  if (words.length < 2) return [trimmed];

  const candidates = [trimmed, words[words.length - 1], words[0]];
  return [...new Set(candidates)];
}
