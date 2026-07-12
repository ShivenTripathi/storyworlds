import { unzipSync } from "fflate";

/**
 * Pure-JS EPUB text extraction for Vercel serverless (no native deps).
 *
 * Approach: `fflate` (tiny pure-JS inflate/unzip) unpacks the archive, then a
 * small hand-rolled parser reads META-INF/container.xml -> the OPF package
 * document -> manifest + spine, so chapters are concatenated in the book's
 * actual reading order (not directory/alphabetical order, which is often
 * wrong). Each XHTML spine document is then stripped to clean paragraph
 * text, preserving blank-line paragraph/heading boundaries so
 * src/domain/reader-format.ts's TOC/heading/paragraph detection keeps
 * working on the result exactly as it does for Gutenberg .txt sources.
 *
 * We evaluated `epub2` (a maintained-ish EPUB parser) but it depends on
 * `unzipper` (Node streams-based, historically flaky under bundlers) and
 * `xml2js`, pulling in more surface area than this needs. A ~150-line
 * fflate + regex parser is small enough to read in full, has zero native
 * deps, and is easy to keep working under Next.js's serverless bundler.
 */

export interface EpubExtractResult {
  text: string;
  title: string | null;
  author: string | null;
}

class EpubParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpubParseError";
  }
}

// ---------------------------------------------------------------------------
// Tiny attribute / tag helpers (regex-based — EPUB's container/OPF/XHTML are
// simple enough that a full XML parser would be overkill here).
// ---------------------------------------------------------------------------

function getAttr(tag: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = tag.match(re);
  if (!m) return undefined;
  return m[1] ?? m[2];
}

function decodeUtf8(bytes: Uint8Array): string {
  // Strip a UTF-8 BOM if present, same convention as the plain-text path.
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  copy: "©",
  reg: "®",
  trade: "™",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
  deg: "°",
  times: "×",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
};

/** Decodes HTML/XML named + numeric character entities. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

const BLOCK_TAG_RE =
  /<\/?(?:p|div|h[1-6]|li|blockquote|section|article|tr|table|hr)\b[^>]*>/gi;

/**
 * Strips a spine XHTML document down to clean paragraph text: drops
 * scripts/styles/comments, converts block-level element boundaries into
 * blank-line paragraph breaks (so headings and paragraphs each land on
 * their own paragraph, matching reader-format's `\n{2,}` split), strips all
 * remaining tags, and decodes entities.
 */
export function htmlToPlainText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");

  const bodyMatch = s.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) s = bodyMatch[1];

  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(BLOCK_TAG_RE, "\n\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);

  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

// ---------------------------------------------------------------------------
// Zip / container / OPF parsing
// ---------------------------------------------------------------------------

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

function resolvePath(baseDir: string, href: string): string {
  const clean = decodeURIComponent(href.split("#")[0]);
  if (!baseDir) return clean.replace(/^\.\//, "");
  const parts = `${baseDir}/${clean}`.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function findEntry(
  entries: Record<string, Uint8Array>,
  path: string,
): Uint8Array | undefined {
  if (entries[path]) return entries[path];
  // Fall back to a case-insensitive match — some producers are inconsistent.
  const lower = path.toLowerCase();
  const key = Object.keys(entries).find((k) => k.toLowerCase() === lower);
  return key ? entries[key] : undefined;
}

/**
 * Extracts the full text of an EPUB (spine documents concatenated in
 * reading order, stripped to clean paragraph text) plus title/author from
 * the OPF `<dc:title>`/`<dc:creator>` metadata, using only pure-JS
 * dependencies (fflate) so it runs on Vercel serverless without native
 * bindings.
 */
// Zip-bomb guard for the EPUB path: a small .epub can carry entries that
// inflate to gigabytes and OOM the serverless function before any downstream
// chunk/size caps run. Refuse to decompress once the cumulative (or any
// single) uncompressed entry exceeds this — mirrors MAX_DECOMPRESSED_BYTES on
// the gzip upload path.
const MAX_EPUB_DECOMPRESSED_BYTES = 200 * 1024 * 1024;

export async function extractEpubText(
  data: Uint8Array,
): Promise<EpubExtractResult> {
  let entries: Record<string, Uint8Array>;
  try {
    // fflate reports each entry's uncompressed `originalSize` from the zip
    // central directory in the filter callback, BEFORE inflating it — so we
    // can bail on a decompression bomb without ever allocating it.
    let totalOut = 0;
    entries = unzipSync(data, {
      filter: (file) => {
        totalOut += file.originalSize;
        if (
          file.originalSize > MAX_EPUB_DECOMPRESSED_BYTES ||
          totalOut > MAX_EPUB_DECOMPRESSED_BYTES
        ) {
          throw new EpubParseError(
            "EPUB decompresses to an unreasonable size — refusing to process.",
          );
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof EpubParseError) throw err;
    throw new EpubParseError(
      `Not a valid EPUB (zip) archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const containerBytes = findEntry(entries, "META-INF/container.xml");
  if (!containerBytes) {
    throw new EpubParseError(
      "Missing META-INF/container.xml — not a valid EPUB.",
    );
  }
  const containerXml = decodeUtf8(containerBytes);
  const rootfileMatch = containerXml.match(/<rootfile\b[^>]*>/i);
  const opfPath = rootfileMatch && getAttr(rootfileMatch[0], "full-path");
  if (!opfPath) {
    throw new EpubParseError(
      "container.xml has no <rootfile full-path> — cannot locate the OPF package document.",
    );
  }

  const opfBytes = findEntry(entries, decodeURIComponent(opfPath));
  if (!opfBytes) {
    throw new EpubParseError(`OPF package document not found at ${opfPath}.`);
  }
  const opfXml = decodeUtf8(opfBytes);
  const opfDir = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/"))
    : "";

  // --- Metadata: dc:title / dc:creator -------------------------------------
  const metadataMatch = opfXml.match(
    /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i,
  );
  const metadataXml = metadataMatch ? metadataMatch[1] : opfXml;

  const titleMatch = metadataXml.match(
    /<(?:dc:)?title\b[^>]*>([\s\S]*?)<\/(?:dc:)?title>/i,
  );
  const title = titleMatch
    ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, "")).trim() || null
    : null;

  const creatorMatches = [
    ...metadataXml.matchAll(
      /<(?:dc:)?creator\b[^>]*>([\s\S]*?)<\/(?:dc:)?creator>/gi,
    ),
  ];
  const author = creatorMatches.length
    ? creatorMatches
        .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim())
        .filter(Boolean)
        .join(", ") || null
    : null;

  // --- Manifest: id -> { href, mediaType, properties } ---------------------
  const manifestMatch = opfXml.match(
    /<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i,
  );
  if (!manifestMatch) {
    throw new EpubParseError("OPF has no <manifest> section.");
  }
  const itemTags = manifestMatch[1].match(/<item\b[^>]*>/gi) ?? [];
  const manifest = new Map<string, ManifestItem>();
  for (const tag of itemTags) {
    const id = getAttr(tag, "id");
    const href = getAttr(tag, "href");
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href,
      mediaType: getAttr(tag, "media-type") ?? "",
      properties: getAttr(tag, "properties") ?? "",
    });
  }

  // --- Spine: reading order of manifest ids --------------------------------
  const spineMatch = opfXml.match(/<spine\b[^>]*>([\s\S]*?)<\/spine>/i);
  if (!spineMatch) {
    throw new EpubParseError("OPF has no <spine> section.");
  }
  const itemrefTags = spineMatch[1].match(/<itemref\b[^>]*>/gi) ?? [];

  const chapters: string[] = [];
  for (const tag of itemrefTags) {
    const idref = getAttr(tag, "idref");
    if (!idref) continue;
    const item = manifest.get(idref);
    if (!item) continue;

    // Skip the EPUB3 nav document and anything that isn't (X)HTML content —
    // e.g. an itemref pointing at an image is not something we can render as
    // prose. toc.ncx is never referenced via itemref (it's the spine's `toc`
    // attribute), so it's excluded automatically.
    if (/\bnav\b/i.test(item.properties)) continue;
    const isHtml =
      /html/i.test(item.mediaType) || /\.x?html?$/i.test(item.href);
    if (!isHtml) continue;

    const path = resolvePath(opfDir, item.href);
    const bytes = findEntry(entries, path);
    if (!bytes) continue;

    const plain = htmlToPlainText(decodeUtf8(bytes));
    if (plain) chapters.push(plain);
  }

  if (chapters.length === 0) {
    throw new EpubParseError(
      "No readable (X)HTML content found in the EPUB spine.",
    );
  }

  const text = chapters
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, title, author };
}
