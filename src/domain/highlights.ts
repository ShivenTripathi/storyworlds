// Single source of truth for the reader's highlighter colors — the server
// validates against this list (highlights routes) and the reader palette
// (SelectionPopover/HighlightEditor) renders from it, so a new color lands in
// both at once. Swatch styling lives in the `--highlight-*` tokens in
// globals.css.
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export function isHighlightColor(value: string): value is HighlightColor {
  return (HIGHLIGHT_COLORS as readonly string[]).includes(value);
}
