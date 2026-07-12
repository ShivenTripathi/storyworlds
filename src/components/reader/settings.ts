// Reader personalization: reading theme, type face, size, line height, and
// measure (line length). Persisted to localStorage, versioned so future
// milestones can migrate the shape without breaking old clients.

export type ReaderThemeId = "paper" | "sepia" | "dusk" | "ink";

export interface ReaderThemeSwatch {
  id: ReaderThemeId;
  label: string;
  bg: string;
  fg: string;
}

// Explicit per-theme colors, independent of the app/world theme tokens —
// the reading surface is a deliberate, self-contained choice the reader
// makes, layered on top of (not derived from) --reader-bg/--reader-fg.
export const READER_THEMES: ReaderThemeSwatch[] = [
  { id: "paper", label: "Paper", bg: "#FBF7EF", fg: "#26211A" },
  { id: "sepia", label: "Sepia", bg: "#F3E9D2", fg: "#4A3F2E" },
  { id: "dusk", label: "Dusk", bg: "#201B14", fg: "#EDE3CF" },
  { id: "ink", label: "Ink", bg: "#0E0C09", fg: "#D8D0C0" },
];

export type FaceId =
  "literata" | "source-serif" | "atkinson" | "georgia" | "opendyslexic";

export interface FaceOption {
  id: FaceId;
  label: string;
  family: string;
}

// Only Literata is actually loaded (via next/font in src/theme/fonts.ts).
// The other faces are named as CSS font-family stacks with serif fallback;
// they may not render as themselves if unavailable on the device — that is
// acceptable for M1.
export const FACES: FaceOption[] = [
  {
    id: "literata",
    label: "Literata",
    family: "var(--font-reading), Georgia, serif",
  },
  {
    id: "source-serif",
    label: "Source Serif 4",
    family: "'Source Serif 4', Georgia, serif",
  },
  {
    id: "atkinson",
    label: "Atkinson Hyperlegible",
    family: "'Atkinson Hyperlegible', Georgia, serif",
  },
  { id: "georgia", label: "Georgia", family: "Georgia, serif" },
  {
    id: "opendyslexic",
    label: "OpenDyslexic",
    family: "'OpenDyslexic', Georgia, serif",
  },
];

export type MeasureId = "narrow" | "comfort" | "wide";

export const MEASURES: { id: MeasureId; label: string; ch: number }[] = [
  { id: "narrow", label: "Narrow", ch: 55 },
  { id: "comfort", label: "Comfort", ch: 65 },
  { id: "wide", label: "Wide", ch: 75 },
];

export const LINE_HEIGHTS = [1.5, 1.65, 1.8, 2.0] as const;

export const FONT_SIZE_MIN = 16;
export const FONT_SIZE_MAX = 24;

export type PageViewId = "single" | "spread";

export const PAGE_VIEWS: { id: PageViewId; label: string }[] = [
  { id: "single", label: "Single" },
  { id: "spread", label: "Spread" },
];

export const JUSTIFY_OPTIONS: { id: boolean; label: string }[] = [
  { id: false, label: "Ragged" },
  { id: true, label: "Justified" },
];

export interface ReaderSettingsState {
  v: 1;
  theme: ReaderThemeId;
  face: FaceId;
  fontSize: number;
  lineHeight: number;
  measure: MeasureId;
  /** Optional (added after v1 shipped; defaulted on load for old clients). */
  pageView?: PageViewId;
  /** Full justification of body paragraphs, off by default. Optional for the
   * same reason as `pageView` above. */
  justify?: boolean;
}

// Dusk closely matches the app's default dark "Fireside" card/foreground
// tokens, so it's the most visually continuous default reading theme.
export const DEFAULT_SETTINGS: ReaderSettingsState = {
  v: 1,
  theme: "dusk",
  face: "literata",
  fontSize: 19,
  lineHeight: 1.65, // spec default 1.7, snapped to nearest step (1.65)
  measure: "comfort",
  pageView: "single",
  justify: false,
};

const STORAGE_KEY = "sw-reader-settings";

function isValidSettings(value: unknown): value is ReaderSettingsState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.theme === "string" &&
    READER_THEMES.some((t) => t.id === v.theme) &&
    typeof v.face === "string" &&
    FACES.some((f) => f.id === v.face) &&
    typeof v.fontSize === "number" &&
    typeof v.lineHeight === "number" &&
    typeof v.measure === "string" &&
    MEASURES.some((m) => m.id === v.measure)
  );
}

export function loadReaderSettings(): ReaderSettingsState {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as unknown;
    // Merge over defaults so fields added after v1 (e.g. pageView) are present.
    return isValidSettings(parsed)
      ? { ...DEFAULT_SETTINGS, ...parsed }
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettingsState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (private mode, quota, etc) — settings just
    // won't persist across sessions this time.
  }
}

export function faceFamily(id: FaceId): string {
  return FACES.find((f) => f.id === id)?.family ?? FACES[0].family;
}

export function themeSwatch(id: ReaderThemeId): ReaderThemeSwatch {
  return READER_THEMES.find((t) => t.id === id) ?? READER_THEMES[2];
}

export function measureCh(id: MeasureId): number {
  return MEASURES.find((m) => m.id === id)?.ch ?? 65;
}
