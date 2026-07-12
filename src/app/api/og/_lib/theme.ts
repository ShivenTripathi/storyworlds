/**
 * Literal EX LIBRIS hex values for `next/og` ImageResponse cards.
 *
 * ImageResponse renders via satori, which produces a static SVG/PNG — it
 * cannot read CSS custom properties from src/app/globals.css or
 * src/theme/archetypes.css. This is therefore the ONE place in the codebase
 * where literal color hex values are correct (see CLAUDE.md "Design tokens
 * only — no literal Tailwind colors in components"): these are baked pixels
 * in a generated image, not token-governed DOM.
 *
 * Values are the exact hex the product brief specified for share cards, not
 * a re-derivation of src/app/globals.css's --ink-950/--parchment-100/etc —
 * keep them in sync by eye if the brand palette ever moves, but do not try
 * to import the CSS tokens here.
 */
export const OG_COLORS = {
  /** Deep parchment/ink ground. */
  groundDark: "#2a1c12",
  /** Primary text on the dark ground. */
  text: "#F6EEE6",
  /** Gild accent — rules, borders, small caps labels. */
  gild: "#D9AB55",
  /** Ember accent — secondary text, chips, warm highlights. */
  ember: "#C9713F",
  /** Muted text for tertiary lines (author, footer). */
  muted: "#C9B896",
} as const;

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** Shared generic font stack — see note in Frame.tsx on why no custom font is embedded. */
export const OG_FONT_DISPLAY = "Georgia, 'Times New Roman', serif" as const;
export const OG_FONT_UI = "'Segoe UI', Helvetica, Arial, sans-serif" as const;
