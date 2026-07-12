/**
 * Pure, dependency-free helpers for detecting a book's upload format and
 * turning plain text into page-sized chunks. Lives in the domain layer so it
 * can run BOTH server-side (the upload route, catalog ingestion) AND in the
 * browser (client-side extraction, which sends already-extracted text to the
 * server to sidestep Vercel's 4.5MB serverless request-body limit).
 */

export type BookSourceFormat = "pdf" | "epub" | "txt";

const EXTENSION_FORMAT: Record<string, BookSourceFormat> = {
  ".pdf": "pdf",
  ".epub": "epub",
  ".txt": "txt",
};

export const ACCEPTED_UPLOAD_EXTENSIONS = Object.keys(EXTENSION_FORMAT);

export function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

/** True if `bytes` starts with the given byte sequence. */
function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }
  return true;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

/** Sniffs a well-formed EPUB zip: PK magic + the "application/epub+zip" marker. */
function looksLikeEpub(data: Uint8Array): boolean {
  if (!startsWith(data, ZIP_MAGIC)) return false;
  const head = new TextDecoder("latin1").decode(data.subarray(0, 256));
  return head.includes("mimetype") && head.includes("application/epub+zip");
}

/** True if `data` decodes as UTF-8 with no NUL bytes (a binary-format tell). */
function looksLikePlainText(data: Uint8Array): boolean {
  const prefix = data.subarray(0, 8000);
  if (prefix.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(prefix);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves an uploaded file to a supported format by extension, then verifies
 * the claim against the file's magic bytes/content — never trusts the
 * extension or client MIME type alone. Returns null for unsupported or
 * spoofed files (e.g. a renamed non-PDF claiming `.pdf`).
 */
export function detectBookFormat(
  filename: string,
  data: Uint8Array,
): BookSourceFormat | null {
  const format = EXTENSION_FORMAT[extensionOf(filename)];
  if (!format) return null;
  if (format === "pdf" && !startsWith(data, PDF_MAGIC)) return null;
  if (format === "epub" && !looksLikeEpub(data)) return null;
  if (format === "txt" && !looksLikePlainText(data)) return null;
  return format;
}

/** Decodes a .txt file as UTF-8, stripping a leading BOM. */
export function decodeTextFile(data: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(data);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Strips a known upload extension for a filename-derived default title. */
export function titleFromFilename(filename: string): string {
  const ext = extensionOf(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const CHUNK_TARGET_CHARS = 1800;
const CHUNK_HARD_MAX_CHARS = 3000;

/** Hard-wraps a single oversized paragraph on whitespace boundaries near `maxChars`. */
function hardWrapParagraph(paragraph: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > maxChars) {
    let splitAt = rest.lastIndexOf(" ", maxChars);
    if (splitAt <= 0) splitAt = maxChars;
    pieces.push(rest.slice(0, splitAt).trim());
    rest = rest.slice(splitAt).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * Splits plain text into page-sized chunks on paragraph (blank-line)
 * boundaries, greedily packing up to ~CHUNK_TARGET_CHARS. A paragraph is
 * never split unless it alone exceeds CHUNK_HARD_MAX_CHARS.
 */
export function chunkPlainText(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const pages: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) return;
    pages.push(current.join("\n\n"));
    current = [];
    currentLength = 0;
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_HARD_MAX_CHARS) {
      flush();
      for (const piece of hardWrapParagraph(paragraph, CHUNK_HARD_MAX_CHARS)) {
        pages.push(piece);
      }
      continue;
    }
    if (
      current.length > 0 &&
      currentLength + paragraph.length > CHUNK_TARGET_CHARS
    ) {
      flush();
    }
    current.push(paragraph);
    currentLength += paragraph.length;
  }
  flush();
  return pages;
}

/** Server-enforced cap: a book can't have more chunks than this (DoS guard). */
export const MAX_CHUNKS = 8000;
