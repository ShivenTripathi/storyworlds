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

export interface TocEntry {
  marker: string;
  title: string;
}

export type Block =
  | { kind: "display"; level: "title" | "meta"; text: string }
  | { kind: "heading"; text: string; section?: boolean }
  | { kind: "toc"; entries: TocEntry[] }
  | { kind: "illustration"; caption: string | null }
  | { kind: "para"; runs: TextRun[]; dropCap?: boolean };

const ILLUSTRATION_RE = /^\[illustrations?:?\s*(.*?)\]$/i;
// A chapter/section marker: "CHAPTER I", "CHAPTER ONE", "CONTENTS", "PROLOGUE",
// a bare roman numeral, or a titled roman-numeral heading ("IV. The Sign").
// The titled form REQUIRES the period after the numeral — without it, every
// first-person sentence ("I am in here.", "I have committed…") would match,
// since "I" is itself a valid roman numeral.
const HEADING_RE =
  /^(chapter\b.*|part\b.*|book\b.*|prologue|epilogue|contents|[ivxlcdm]{1,7}\.?|[ivxlcdm]{1,7}\.\s+.{0,60})$/i;
// A bare section number on its own line ("I.", "IV.") — styled quieter than a
// full chapter title so it doesn't compete with it.
const SECTION_RE = /^[ivxlcdm]{1,7}\.?$/i;
// A run-together table of contents: three or more "<roman>. Title" entries in
// one paragraph, e.g. "I. A Scandal in Bohemia II. The Red-Headed League …".
const TOC_ENTRY_RE = /\b([IVXLCDM]{1,7})\.\s+(.+?)(?=\s+[IVXLCDM]{1,7}\.\s|$)/g;

function parseToc(text: string): TocEntry[] | null {
  const entries: TocEntry[] = [];
  let m: RegExpExecArray | null;
  TOC_ENTRY_RE.lastIndex = 0;
  while ((m = TOC_ENTRY_RE.exec(text)) !== null) {
    entries.push({ marker: m[1], title: m[2].trim() });
  }
  return entries.length >= 3 ? entries : null;
}

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

/**
 * Appends a soft-wrapped line to the current paragraph, healing a word broken
 * across the wrap. PDF/OCR extraction keeps the typesetter's line-break
 * hyphen ("inter-\nview"): if the continuation is lowercase the hyphen split
 * one word (drop it → "interview"); if it's capitalised it's a real compound
 * that happened to wrap ("half-\nWindsors" → "half-Windsors", hyphen kept).
 */
function appendWrapped(cur: string, line: string): string {
  if (!cur) return line;
  if (/\p{L}-$/u.test(cur)) {
    const next = line[0] ?? "";
    if (/\p{Ll}/u.test(next)) return cur.slice(0, -1) + line;
    return cur + line;
  }
  return cur + " " + line;
}

// A line of dot leaders ending in a page number — a table-of-contents row
// ("YEAR OF GLAD ........ 6"). Always its own line, never joined to the next.
const DOT_LEADER_RE = /\.{4,}\s*\d*\s*$/;

/**
 * Reflows raw extracted prose into clean paragraphs. PDF/OCR extraction emits
 * one line per *visual* line and frequently no blank line between paragraphs,
 * so naive rendering yields a run-on wall of text with mid-word hyphens and
 * headings glued onto the next sentence ("YEAR OF GLAD\nI am seated…").
 *
 * For each block of single-newline lines it joins soft wraps with a space,
 * de-hyphenates broken words, and infers a paragraph break wherever a line
 * stops well short of the column width — the tell-tale of a paragraph's last
 * line. Blank-line paragraph breaks already in the text (e.g. Project
 * Gutenberg) are preserved, so this is safe and idempotent on clean input.
 */
export function reflowProse(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map(reflowBlock)
    .filter(Boolean)
    .join("\n\n");
}

function reflowBlock(block: string): string {
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return lines.join("");

  // Estimate the column width from the 90th-percentile line length; a line far
  // shorter than that didn't fill the column, so it ended a paragraph.
  const sorted = lines.map((l) => l.length).sort((a, b) => a - b);
  const full = sorted[Math.floor((sorted.length - 1) * 0.9)];
  const shortThreshold = full * 0.72;

  const paras: string[] = [];
  let cur = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    cur = appendWrapped(cur, line);
    const endsParagraph =
      i === lines.length - 1 ||
      line.length < shortThreshold ||
      DOT_LEADER_RE.test(line);
    if (endsParagraph) {
      paras.push(cur);
      cur = "";
    }
  }
  if (cur) paras.push(cur);
  return paras.join("\n\n");
}

export function formatChunk(text: string): Block[] {
  const paragraphs = reflowProse(text)
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

    // A run-together table of contents → a real list, one entry per line.
    const toc = parseToc(para);
    if (toc) {
      blocks.push({ kind: "toc", entries: toc });
      continue;
    }

    if (isHeading(para)) {
      const text = unwrapBrackets(para).trim();
      const section = SECTION_RE.test(text);
      blocks.push({ kind: "heading", text, section: section || undefined });
      // A titled chapter heading opens the chapter (drop-cap the next prose); a
      // bare section number ("I.") does not restart it.
      if (!section) pendingDropCap = true;
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
