// Shared types for the "world awakening" surfaces (book detail page +
// reader WorldRail). These mirror the API contract for
// POST /api/books/{id}/analyze, GET /api/jobs/{id}(/stream), and
// GET /api/books/{id}/world.

type JobStatus = "queued" | "running" | "completed" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  progress: number;
  stage?: string | null;
  error?: string | null;
}

type WorldStatus = "none" | "pending" | "completed" | "failed";

interface EntityAttributes {
  /** A fuller 2-3 sentence introduction of who this entity is as
   * introduced — not frontier-gated, unlike the inner-life fields below. */
  description?: string;
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

// ---------------------------------------------------------------------------
// Character dossier — GET /api/books/{id}/world/entities/{entityId}
// ---------------------------------------------------------------------------

/** A framed scene illustration featuring the character. */
export interface DossierVisual {
  imageUrl: string | null;
  caption: string | null;
  page: number | null;
}

/** Where in the read-so-far book the character is active. */
export interface DossierAppearances {
  pageCount: number;
  firstPage: number | null;
  lastPage: number | null;
  ticks: number[];
  frontierChunk: number | null;
  totalChunks: number | null;
}

/** Another entity the character shares scenes with, ranked by shared pages. */
export interface DossierRelationship {
  id: string;
  name: string;
  kind: string;
  sharedPages: number;
}

export interface DossierData {
  entity: WorldEntity;
  themeArchetype: string | null;
  innerLifeGated: boolean;
  visual: DossierVisual;
  appearances: DossierAppearances;
  relationships: DossierRelationship[];
}

interface TimelineEntry {
  label: string;
  summary: string;
  approxPage?: number;
}

interface WorldVisualStyle {
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

interface OverlayActiveEntity {
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
