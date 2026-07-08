/**
 * Groups book chunks into LLM-analysis segments: greedily pack whole chunks
 * under a character budget, joined with `[PAGE N]` markers so the model can
 * report which page (1-based chunk index) an entity/event appeared on.
 */

export interface Chunk {
  idx: number;
  text: string;
}

export interface Segment {
  index: number;
  startChunk: number;
  endChunk: number;
  text: string;
}

const PAGE_MARKER = (idx: number) => `\n\n[PAGE ${idx + 1}]\n\n`;

/**
 * Greedily accumulate whole chunks into segments no larger than `maxChars`.
 * A single chunk whose own text exceeds `maxChars` becomes its own segment
 * (chunks are never split). Segment text joins chunk texts with page
 * markers; segment.index is 0-based order, startChunk/endChunk are the
 * inclusive range of chunk idx values covered.
 */
export function segmentChunks(chunks: Chunk[], maxChars = 80_000): Segment[] {
  const segments: Segment[] = [];

  let current: Chunk[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) return;
    segments.push(buildSegment(segments.length, current));
    current = [];
    currentLength = 0;
  };

  for (const chunk of chunks) {
    const addedLength = PAGE_MARKER(chunk.idx).length + chunk.text.length;

    if (current.length > 0 && currentLength + addedLength > maxChars) {
      flush();
    }

    current.push(chunk);
    currentLength += addedLength;

    // Oversize single chunk: isolate it immediately as its own segment.
    if (current.length === 1 && currentLength > maxChars) {
      flush();
    }
  }

  flush();

  return segments;
}

function buildSegment(index: number, chunks: Chunk[]): Segment {
  const text = chunks
    .map((c) => `[PAGE ${c.idx + 1}]\n\n${c.text}`)
    .join("\n\n");

  return {
    index,
    startChunk: chunks[0].idx,
    endChunk: chunks[chunks.length - 1].idx,
    text,
  };
}
