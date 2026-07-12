/**
 * Turns a chunk's plain text (often raw Project Gutenberg output) into a list
 * of typographic blocks the reader can render beautifully — cleaning the
 * source markup that would otherwise leak through:
 *
 *  - `_italic_`               → italic runs (Gutenberg's underscore convention)
 *  - `[Illustration: caption]`→ an ornamental figure block
 *  - `[_editorial._]`         → unwrapped, italicized (brackets dropped)
 *  - ALL-CAPS short lines     → centered "display" lines (title-page feel)
 *  - `CHAPTER I` / roman numerals → headings; the paragraph after opens with a drop cap
 *
 * Pure and dependency-free so it's unit-testable and lives in the domain layer.
 */

export interface TextRun {
  text: string;
  italic?: boolean;
}

export type Block =
  | { kind: "display"; level: "title" | "meta"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "illustration"; caption: string | null }
  | { kind: "para"; runs: TextRun[]; dropCap?: boolean };

const ILLUSTRATION_RE = /^\[illustrations?:?\s*(.*?)\]$/i;
// A chapter marker: "CHAPTER I", "CHAPTER 1", "CHAPTER ONE", or a bare roman
// numeral / "I." on its own line.
const HEADING_RE =
  /^(chapter\b.*|[ivxlcdm]{1,7}\.?|[ivxlcdm]{1,7}\s+.{0,60})$/i;

/** Removes Gutenberg editorial bracket-wrappers around italic spans. */
function unwrapBrackets(text: string): string {
  return text.replace(/\[_/g, "_").replace(/_\]/g, "_");
}

/** Splits a line into normal/italic runs on `_..._` pairs. */
function parseRuns(text: string): TextRun[] {
  const cleaned = unwrapBrackets(text);
  const runs: TextRun[] = [];
  const re = /_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) runs.push({ text: cleaned.slice(last, m.index) });
    runs.push({ text: m[1], italic: true });
    last = re.lastIndex;
  }
  if (last < cleaned.length) runs.push({ text: cleaned.slice(last) });
  if (runs.length === 0) runs.push({ text: cleaned });
  return runs;
}

/** True when a paragraph is a short all-caps line (title-page material). */
function isDisplayLine(text: string): boolean {
  const stripped = unwrapBrackets(text).replace(/[^A-Za-z]/g, "");
  if (stripped.length < 2) return false;
  if (/[a-z]/.test(stripped)) return false; // has lowercase → not a caps line
  return text.length <= 64 && !text.includes("\n");
}

function isHeading(text: string): boolean {
  if (text.includes("\n") || text.length > 70) return false;
  return HEADING_RE.test(text.trim());
}

export function formatChunk(text: string): Block[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+\n/g, "\n").trim())
    .filter(Boolean);

  const blocks: Block[] = [];
  let pendingDropCap = false;

  for (const para of paragraphs) {
    const illo = para.match(ILLUSTRATION_RE);
    if (illo) {
      const caption = illo[1].trim();
      blocks.push({ kind: "illustration", caption: caption || null });
      continue;
    }

    if (isHeading(para)) {
      blocks.push({ kind: "heading", text: unwrapBrackets(para).trim() });
      pendingDropCap = true; // the next prose paragraph opens the chapter
      continue;
    }

    if (isDisplayLine(para)) {
      const clean = unwrapBrackets(para).trim();
      blocks.push({
        kind: "display",
        level: clean.length <= 24 ? "title" : "meta",
        text: clean,
      });
      continue;
    }

    const runs = parseRuns(para);
    blocks.push({ kind: "para", runs, dropCap: pendingDropCap || undefined });
    pendingDropCap = false;
  }

  return blocks;
}

/** First non-space character of a run list — used to render a drop cap. */
export function splitDropCap(runs: TextRun[]): {
  cap: string;
  rest: TextRun[];
} | null {
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const m = r.text.match(/^(\s*)(\S)([\s\S]*)$/);
    if (!m) continue;
    const cap = m[2];
    if (!/[A-Za-z]/.test(cap)) return null; // don't drop-cap punctuation/quotes
    const rest: TextRun[] = [
      { text: m[1] + m[3], italic: r.italic },
      ...runs.slice(i + 1),
    ];
    return { cap, rest };
  }
  return null;
}
