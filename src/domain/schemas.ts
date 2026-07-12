/**
 * Zod schemas for every LLM structured-output contract in the analysis
 * pipeline. These ARE the contract — the LLM driver (src/ai/) validates raw
 * model output against these before anything touches the DB.
 *
 * Page numbers are 1-based for the LLM (they match the `[PAGE N]` markers
 * produced by `segmentChunks`); `pageToChunkIdx` converts back to the
 * 0-based chunk index used everywhere else in the system.
 */

import { z } from "zod";
import { ENTITY_KINDS } from "./entities/slug";
import { ARCHETYPES } from "@/theme/archetypes";

/** Convert a 1-based LLM-reported page number to a 0-based chunk index. */
export function pageToChunkIdx(page: number): number {
  return page - 1;
}

// ---------------------------------------------------------------------------
// SegmentAnalysisSchema — per-segment extraction pass
// ---------------------------------------------------------------------------

export const SegmentEntitySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(ENTITY_KINDS),
  aliases: z.array(z.string()).default([]),
  description: z.string(),
  visualDescription: z.string().optional(),
  firstSeenPage: z.number().int().optional(),
});

export const SegmentEventSchema = z.object({
  summary: z.string(),
  page: z.number().int().optional(),
});

export const SegmentAnalysisSchema = z.object({
  entities: z.array(SegmentEntitySchema),
  events: z.array(SegmentEventSchema),
  settingNotes: z.string().optional(),
});

export type SegmentAnalysis = z.infer<typeof SegmentAnalysisSchema>;
export type SegmentEntity = z.infer<typeof SegmentEntitySchema>;
export type SegmentEvent = z.infer<typeof SegmentEventSchema>;

// ---------------------------------------------------------------------------
// WorldSynthesisSchema — whole-book synthesis pass
// ---------------------------------------------------------------------------

export const VisualStyleSchema = z.object({
  artStyle: z.string(),
  colorPalette: z.string(),
  mood: z.string(),
  eraSetting: z.string(),
  themeArchetype: z.enum(ARCHETYPES),
});

export const WorldEntityAttributesSchema = z.object({
  // A fuller, 2-3 sentence introduction of who this entity is AS INTRODUCED
  // in the story so far — never their arc's resolution. Unlike
  // internalState/keyMotivation/scars below, this is not frontier-gated (it
  // reads like a character-guide entry, not a spoiler), so it renders
  // immediately wherever the entity itself is visible.
  description: z.string().optional(),
  role: z.string().optional(),
  internalState: z.string().optional(),
  keyMotivation: z.string().optional(),
  scars: z.string().optional(),
});

export const WorldEntitySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(ENTITY_KINDS),
  aliases: z.array(z.string()).default([]),
  attributes: WorldEntityAttributesSchema,
  visualDescription: z.string().optional(),
  introducedAtPage: z.number().int().optional(),
});

export const TimelineEntrySchema = z.object({
  label: z.string(),
  summary: z.string(),
  approxPage: z.number().int().optional(),
});

export const CommitmentSchema = z.object({
  claim: z.string(),
  status: z.enum(["open", "fulfilled", "broken"]).default("open"),
});

export const UnknownSchema = z.object({
  question: z.string(),
  kind: z.string().optional(),
});

export const WorldSynthesisSchema = z.object({
  settingDescription: z.string(),
  // A spoiler-free back-cover teaser (~40-60 words) shown on Discover cards
  // and the book-detail page BEFORE anyone has read a page — it must never
  // reveal plot resolution, twists, or how the story ends.
  blurb: z.string(),
  visualStyle: VisualStyleSchema,
  entities: z.array(WorldEntitySchema),
  timeline: z.array(TimelineEntrySchema).default([]),
  commitments: z.array(CommitmentSchema).default([]),
  unknowns: z.array(UnknownSchema).default([]),
});

export type WorldSynthesis = z.infer<typeof WorldSynthesisSchema>;
export type WorldEntity = z.infer<typeof WorldEntitySchema>;
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type Commitment = z.infer<typeof CommitmentSchema>;
export type Unknown = z.infer<typeof UnknownSchema>;

// ---------------------------------------------------------------------------
// OverlaySchema — per-page overlay (illustration prompt + reading companion
// notes) generated on demand as a reader reaches a page.
// ---------------------------------------------------------------------------

const MAX_SUGGESTED_QUESTIONS = 3;

export const OverlayActiveEntitySchema = z.object({
  name: z.string().min(1),
});

export const OverlaySchema = z.object({
  // Concrete, visual, illustratable description of what's happening on this
  // page — written so an image model can turn it directly into a scene.
  sceneDescription: z.string().min(1),
  // Entities (by name, exact spelling as provided in the world entity list)
  // that are active/present on this page. Resolved to entity IDs downstream
  // via the alias index — never trust these as IDs.
  activeEntities: z.array(OverlayActiveEntitySchema).default([]),
  mood: z.string().optional(),
  // A lens on what this page is doing (themes, callbacks) — never a
  // reference to future plot events.
  interpretiveNotes: z.string().optional(),
  // Up to MAX_SUGGESTED_QUESTIONS questions a curious reader might ask a
  // character on this page. Extra entries are trimmed rather than rejected,
  // since trimming is cheap and keeps a slightly-over-eager LLM response
  // usable instead of forcing a costly retry.
  suggestedQuestions: z
    .array(z.string())
    .default([])
    .transform((qs) => qs.slice(0, MAX_SUGGESTED_QUESTIONS)),
});

export type Overlay = z.infer<typeof OverlaySchema>;
export type OverlayActiveEntity = z.infer<typeof OverlayActiveEntitySchema>;

// ---------------------------------------------------------------------------
// FunFactsSchema — spoiler-free "Did you know?" facts generated from ONLY a
// book's title/author (+ optional era hint), shown BEFORE reading to make
// the book more inviting to open (see src/ai/prompts/funfacts.ts). Unlike
// every other schema in this file, this is real-world trivia rather than
// content extracted from the book's own text — accuracy matters more than
// coverage, so there is deliberately NO minimum array length: the prompt
// instructs the model to omit a fact rather than invent one it isn't
// confident about, and an empty list is a valid, honest result.
// ---------------------------------------------------------------------------

export const FUN_FACT_CATEGORIES = [
  "author",
  "history",
  "trivia",
  "legacy",
] as const;

export const FunFactSchema = z.object({
  text: z.string().min(1),
  category: z.enum(FUN_FACT_CATEGORIES),
});

const MAX_FUN_FACTS = 6;

export const FunFactsSchema = z.object({
  facts: z
    .array(FunFactSchema)
    .default([])
    .transform((facts) => facts.slice(0, MAX_FUN_FACTS)),
});

export type FunFactCategory = (typeof FUN_FACT_CATEGORIES)[number];
export type FunFact = z.infer<typeof FunFactSchema>;
export type FunFacts = z.infer<typeof FunFactsSchema>;
