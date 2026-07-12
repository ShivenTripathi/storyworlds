const USER_AGENT =
  "StoryWorldsCatalogBot/1.0 (+https://github.com/story-worlds; catalog ingestion, low volume, contact via repo issues)";

const FETCH_TIMEOUT_MS = 60_000;

const START_MARKER =
  /\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*\*\*\*/i;
const END_MARKER =
  /\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*\*\*\*/i;

function gutenbergUrls(id: number): string[] {
  return [
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
    `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
  ];
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Gutenberg fetch failed: ${url} -> HTTP ${res.status}`);
  }
  return res.text();
}

/** Strips the Project Gutenberg license header/footer, keeping only the book body. */
function stripBoilerplate(raw: string): string {
  const startMatch = raw.match(START_MARKER);
  const endMatch = raw.match(END_MARKER);

  if (!startMatch || !endMatch) {
    return raw;
  }

  const startIdx = (startMatch.index ?? 0) + startMatch[0].length;
  const endIdx = endMatch.index ?? raw.length;
  if (endIdx <= startIdx) {
    return raw;
  }
  return raw.slice(startIdx, endIdx);
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fetches and cleans the plain-text body of a Project Gutenberg ebook by id,
 * trying the modern `cache/epub` path first and falling back to the legacy
 * `files/{id}/{id}-0.txt` path. Throws a clear error if both fail.
 */
export async function fetchGutenbergText(id: number): Promise<string> {
  const urls = gutenbergUrls(id);
  const errors: string[] = [];

  for (const url of urls) {
    try {
      const raw = await fetchText(url);
      return normalize(stripBoilerplate(raw));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  throw new Error(
    `Failed to fetch Gutenberg ebook ${id} from all known URLs: ${errors.join("; ")}`,
  );
}
