/**
 * Pure card logic for the gamified Codex (collectible character/location
 * cards). No imports from db/, ai/, or react — unit-testable in isolation.
 *
 * SPOILER SAFETY (see CLAUDE.md + src/services/world.ts getWorldForReader):
 * a card's visible state is derived from the SAME fail-closed frontier gate
 * as the rest of the reader-facing world data. An entity whose
 * `introducedAtChunk` is null (the pipeline couldn't place it) or sits ahead
 * of the reader's frontier must never be revealed — `cardState` treats both
 * as 'locked' rather than assuming safety.
 */

/**
 * - 'locked': the reader hasn't reached this entity's introduction yet (or
 *   its introduction point is unknown) — render as a pure silhouette, no
 *   name/rarity/attributes.
 * - 'met': the reader has reached the entity's introduction but is still
 *   within the "inner life" reveal buffer (mirrors
 *   INNER_LIFE_REVEAL_BUFFER_CHUNKS in world.ts) — name/kind/rarity are
 *   safe to show, but nothing that presumes deep familiarity.
 * - 'known': the reader is past the buffer (or viewing as owner/admin) —
 *   full card.
 */
export type CardState = "locked" | "met" | "known";

export type Rarity = "common" | "rare" | "epic" | "legendary";

/** Same buffer width as INNER_LIFE_REVEAL_BUFFER_CHUNKS in src/services/world.ts. */
export const DEFAULT_REVEAL_BUFFER_CHUNKS = 20;

/**
 * Computes a card's visibility state for a reader.
 *
 * FAILS CLOSED: `frontierChunk === null` means an unfiltered (owner/admin)
 * view — everything is 'known'. Any other input where the entity's
 * introduction point can't be confidently placed at-or-behind the frontier
 * resolves to 'locked', never leaked open by default.
 *
 * @param introducedAtChunk 0-based chunk the entity first appears at, or
 *   null if the analysis pipeline couldn't place it.
 * @param frontierChunk the reader's max-reached chunk, or null for an
 *   unfiltered owner/admin view.
 * @param revealBuffer chunks after introduction before inner-life content
 *   ('known') unlocks; defaults to the same width used for dossier gating.
 */
export function cardState(
  introducedAtChunk: number | null,
  frontierChunk: number | null,
  revealBuffer: number = DEFAULT_REVEAL_BUFFER_CHUNKS,
): CardState {
  if (frontierChunk === null) return "known"; // owner/admin: unfiltered

  // Fail CLOSED: an unknown introduction point is treated as a spoiler risk,
  // exactly like getWorldForReader's entity filter.
  if (introducedAtChunk === null || introducedAtChunk === undefined) {
    return "locked";
  }
  if (introducedAtChunk > frontierChunk) return "locked";

  if (frontierChunk < introducedAtChunk + revealBuffer) return "met";
  return "known";
}

export interface ProminenceInput {
  /** Overlays (pages) within the reader's frontier the entity is active on. */
  pageCount: number;
  /** Distinct other entities they share at least one scene with. */
  relationshipDegree: number;
  /** Chat messages/turns the reader has had with this entity. */
  chatCount: number;
  /** Book length in chunks, for normalizing pageCount into "screen time". */
  totalChunks: number;
}

// Weights: screen-time dominates (it's the strongest, least-gameable signal
// of narrative importance — a protagonist is on far more pages than a
// one-scene extra), relationship degree is a secondary structural signal
// (well-connected characters tend to matter more), and chat count is a
// deliberately small nudge so a reader can bump a favorite minor character up
// a tier by engaging with them, without chat spam alone being able to mint a
// legendary out of a background character.
const SCREEN_TIME_WEIGHT = 0.55;
const RELATIONSHIP_WEIGHT = 0.25;
const CHAT_WEIGHT = 0.2;

// Saturation points: relationship degree and chat count are unbounded counts,
// so they're normalized against a "this is already a lot" ceiling rather
// than the book's full scale — beyond these, more doesn't add more score.
const RELATIONSHIP_SATURATION_DEGREE = 8;
const CHAT_SATURATION_COUNT = 20;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * A 0..1 prominence score blending screen-time, relationship centrality, and
 * chat engagement. Documented weights above; see rarityFromScore for how
 * this maps to a rarity tier.
 */
export function prominenceScore(input: ProminenceInput): number {
  const { pageCount, relationshipDegree, chatCount, totalChunks } = input;

  const screenTime = totalChunks > 0 ? clamp01(pageCount / totalChunks) : 0;
  const relationship = clamp01(
    relationshipDegree / RELATIONSHIP_SATURATION_DEGREE,
  );
  const chat = clamp01(chatCount / CHAT_SATURATION_COUNT);

  return clamp01(
    screenTime * SCREEN_TIME_WEIGHT +
      relationship * RELATIONSHIP_WEIGHT +
      chat * CHAT_WEIGHT,
  );
}

// Thresholds chosen so a protagonist (active on most pages, well-connected)
// clears 'legendary', a strong supporting character lands 'epic'/'rare', and
// a one-scene figure (tiny screen-time share, few/no relationships or chats)
// stays 'common'.
const LEGENDARY_THRESHOLD = 0.55;
const EPIC_THRESHOLD = 0.32;
const RARE_THRESHOLD = 0.12;

/** Maps a 0..1 prominence score to a collectible-card rarity tier. */
export function rarityFromScore(score: number): Rarity {
  if (score >= LEGENDARY_THRESHOLD) return "legendary";
  if (score >= EPIC_THRESHOLD) return "epic";
  if (score >= RARE_THRESHOLD) return "rare";
  return "common";
}
