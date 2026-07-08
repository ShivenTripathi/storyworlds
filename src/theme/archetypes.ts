/**
 * EX LIBRIS per-book "world" theme archetypes.
 *
 * Each archetype overrides the Layer 3 product tokens
 * (--world-accent, --world-accent-fg, --world-surface, --world-frame)
 * defined in `src/theme/archetypes.css`, scoped to
 * `[data-world-theme="<id>"]` for both the dark "Fireside" default and
 * the light "Reading Room" (`[data-app-theme="light"]`) palettes.
 */

export const ARCHETYPES = [
  "classic",
  "gothic",
  "noir",
  "regency",
  "golden-age-scifi",
  "desert-epic",
  "mythic",
  "maritime",
  "pastoral",
  "jazz-age",
  "cosmic-weird",
  "fairy-tale",
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

export const ARCHETYPE_META: Record<
  Archetype,
  { label: string; description: string }
> = {
  classic: {
    label: "Classic",
    description: "The library's own ember — warm, dependable, unadorned.",
  },
  gothic: {
    label: "Gothic",
    description: "Candlelit stone and old blood — romance with a shiver.",
  },
  noir: {
    label: "Noir",
    description: "Brass and shadow — a detective's desk lamp at midnight.",
  },
  regency: {
    label: "Regency",
    description: "Powder-blue drawing rooms and starched correspondence.",
  },
  "golden-age-scifi": {
    label: "Golden-Age Sci-Fi",
    description: "Pulp-paper orange and chrome optimism, rockets included.",
  },
  "desert-epic": {
    label: "Desert Epic",
    description: "Sun-baked clay and long horizons under a wide sky.",
  },
  mythic: {
    label: "Mythic",
    description: "Old gold leaf on older parchment — gods and origins.",
  },
  maritime: {
    label: "Maritime",
    description: "Deep harbor teal and salt-worn brass fittings.",
  },
  pastoral: {
    label: "Pastoral",
    description: "Hedgerow green and quiet fields at the end of summer.",
  },
  "jazz-age": {
    label: "Jazz Age",
    description: "Emerald neon and gin-clear ambition, after hours.",
  },
  "cosmic-weird": {
    label: "Cosmic Weird",
    description: "Violet static at the edge of what can be known.",
  },
  "fairy-tale": {
    label: "Fairy Tale",
    description: "Briar-rose and berry ink, half-remembered by morning.",
  },
};

export const DEFAULT_ARCHETYPE: Archetype = "classic";
