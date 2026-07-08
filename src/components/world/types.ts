// Shared types for the "world awakening" surfaces (book detail page +
// reader WorldRail). These mirror the API contract for
// POST /api/books/{id}/analyze, GET /api/jobs/{id}(/stream), and
// GET /api/books/{id}/world.

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  progress: number;
  stage?: string | null;
  error?: string | null;
}

export type WorldStatus = "none" | "pending" | "completed" | "failed";

export type EntityKind = "character" | "place" | "object" | "faction";

export interface EntityAttributes {
  role?: string;
  internalState?: string;
  keyMotivation?: string;
  scars?: string;
  [key: string]: string | undefined;
}

export interface WorldEntity {
  id: string;
  name: string;
  kind: string;
  attributes?: EntityAttributes;
  visualDescription?: string;
  introducedAtChunk?: number;
}

export interface TimelineEntry {
  label: string;
  summary: string;
  approxPage?: number;
}

export interface WorldVisualStyle {
  artStyle?: string;
  mood?: string;
  eraSetting?: string;
  [key: string]: string | undefined;
}

export interface WorldCounts {
  total: number;
  visible: number;
}

export interface World {
  status: WorldStatus;
  settingDescription?: string;
  visualStyle?: WorldVisualStyle;
  themeArchetype?: string;
  entities?: WorldEntity[];
  timeline?: TimelineEntry[];
  counts?: WorldCounts;
}

export interface WorldResponse {
  world: World;
  job?: Job;
}

export interface JobResponse {
  job: Job;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Scene overlays — GET /api/books/{id}/overlays/{idx}
// ---------------------------------------------------------------------------

export interface OverlayActiveEntity {
  id: string;
  name: string;
  kind: string;
}

export interface Overlay {
  chunkIdx: number;
  sceneDescription: string;
  interpretiveNotes?: string | null;
  mood?: string | null;
  suggestedQuestions: string[];
  activeEntities: OverlayActiveEntity[];
  imageUrl: string | null;
  imageIsForwardFill: boolean;
}

export interface OverlayResponse {
  overlay?: Overlay;
  pending?: boolean;
}
