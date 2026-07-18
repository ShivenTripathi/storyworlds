// Client-side mirror of the Codex API contract
// (GET /api/books/{id}/codex -> getCodexForBook in src/services/analytics.ts).
// Duplicated here rather than imported from services/ to keep this client
// surface decoupled from the server-only analytics module — the same
// pattern components/world/types.ts uses for the world API contract.
//
// `Rarity` itself IS imported from src/domain/codex.ts: that module is pure
// domain logic (no db/ai imports), so it's safe and cheap to share as a
// type-only import.
import type { Rarity } from "@/domain/codex";

export type { Rarity };

/**
 * A locked card leaks NOTHING beyond its category and grid position — no
 * id, name, or rarity. Never render anything more than that for a locked
 * card; that's the spoiler-safety contract the server enforces.
 */
interface CodexCardLocked {
  state: "locked";
  kind: string;
  slot: number;
}

export interface CodexCardRevealed {
  state: "met" | "known";
  id: string;
  name: string;
  kind: string;
  rarity: Rarity;
  portraitUrl: string | null;
  /**
   * True when this entity has been discovered but the illustration pipeline
   * hasn't produced a portrait yet — the "illustration developing" state,
   * distinct from both 'locked' and a fully-revealed portrait.
   */
  illustrationPending: boolean;
  slot: number;
}

export type CodexCardData = CodexCardLocked | CodexCardRevealed;

interface CodexCounts {
  [kind: string]: { met: number; total: number };
}

export interface CodexDto {
  cards: CodexCardData[];
  counts: CodexCounts;
}
