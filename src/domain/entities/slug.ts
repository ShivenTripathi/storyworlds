/**
 * Deterministic entity slug minting.
 *
 * CRITICAL: entity IDs are minted here in code, never invented by an LLM.
 * LLMs only ever emit names/aliases; those get resolved or slugified through
 * this module. See CLAUDE.md "Entity IDs are minted in code".
 */

export const ENTITY_KINDS = [
  "character",
  "location",
  "object",
  "faction",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

const ENTITY_KIND_PREFIX: Record<EntityKind, string> = {
  character: "char",
  location: "loc",
  object: "obj",
  faction: "fac",
};

const MAX_SLUG_BODY_LENGTH = 60;

// Unicode combining diacritical marks block, left behind after NFKD
// decomposition (e.g. "e" + COMBINING ACUTE ACCENT).
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

/**
 * Build a deterministic slug like `char:paul-atreides` for the given kind
 * and display name. Diacritics are stripped, non-alphanumeric runs collapse
 * to a single dash, and the result is capped at 60 characters. If nothing
 * usable remains after cleaning, falls back to `${prefix}:unnamed`.
 */
export function slugifyEntity(kind: EntityKind, name: string): string {
  const prefix = ENTITY_KIND_PREFIX[kind];
  const body = cleanSlugBody(name);
  return `${prefix}:${body.length > 0 ? body : "unnamed"}`;
}

function cleanSlugBody(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(COMBINING_MARKS_RE, "")
    .toLowerCase();

  const dashed = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  return dashed.slice(0, MAX_SLUG_BODY_LENGTH).replace(/-+$/g, "");
}

/**
 * Given a candidate slug and the set of slugs already taken, append -2, -3,
 * ... until a free slug is found. Returns the input slug unchanged if it's
 * not already taken.
 */
export function dedupeSlug(slug: string, taken: Set<string>): string {
  if (!taken.has(slug)) return slug;

  let n = 2;
  let candidate = `${slug}-${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${slug}-${n}`;
  }
  return candidate;
}
