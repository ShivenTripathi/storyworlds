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
