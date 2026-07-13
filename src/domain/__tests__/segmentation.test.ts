import { describe, expect, it } from "vitest";
import { segmentChunks } from "../segmentation";

describe("segmentChunks", () => {
  it("packs multiple small chunks into one segment under the limit", () => {
    const chunks = [
      { idx: 0, text: "a".repeat(100) },
      { idx: 1, text: "b".repeat(100) },
      { idx: 2, text: "c".repeat(100) },
    ];
    const segments = segmentChunks(chunks, 1000);
    expect(segments).toHaveLength(1);
    expect(segments[0].startChunk).toBe(0);
    expect(segments[0].endChunk).toBe(2);
  });

  it("splits into multiple segments once the limit is exceeded", () => {
    const chunks = [
      { idx: 0, text: "a".repeat(400) },
      { idx: 1, text: "b".repeat(400) },
      { idx: 2, text: "c".repeat(400) },
    ];
    const segments = segmentChunks(chunks, 700);
    expect(segments.length).toBeGreaterThan(1);
    for (const seg of segments) {
      expect(seg.text.length).toBeLessThanOrEqual(1000); // allows marker overhead
    }
  });

  it("isolates a single oversize chunk into its own segment", () => {
    const chunks = [
      { idx: 0, text: "a".repeat(50) },
      { idx: 1, text: "b".repeat(2000) }, // exceeds maxChars alone
      { idx: 2, text: "c".repeat(50) },
    ];
    const segments = segmentChunks(chunks, 500);
    const oversizeSeg = segments.find(
      (s) => s.startChunk === 1 && s.endChunk === 1,
    );
    expect(oversizeSeg).toBeDefined();
    expect(oversizeSeg!.text).toContain("b".repeat(2000));
    // Never split a chunk: full chunk text present in exactly one segment.
    const occurrences = segments.filter((s) =>
      s.text.includes("b".repeat(2000)),
    );
    expect(occurrences).toHaveLength(1);
  });

  it("includes [PAGE N] markers using 1-based page numbers", () => {
    const chunks = [
      { idx: 0, text: "hello" },
      { idx: 5, text: "world" },
    ];
    const segments = segmentChunks(chunks, 1000);
    expect(segments[0].text).toContain("[PAGE 1]");
    expect(segments[0].text).toContain("[PAGE 6]");
  });

  it("produces contiguous, gapless segment indexes", () => {
    const chunks = Array.from({ length: 10 }, (_, i) => ({
      idx: i,
      text: "x".repeat(50),
    }));
    const segments = segmentChunks(chunks, 120);
    segments.forEach((seg, i) => expect(seg.index).toBe(i));
    // startChunk/endChunk cover the full range contiguously
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startChunk).toBe(segments[i - 1].endChunk + 1);
    }
    expect(segments[0].startChunk).toBe(0);
    expect(segments[segments.length - 1].endChunk).toBe(9);
  });

  it("handles an empty chunk list", () => {
    expect(segmentChunks([], 1000)).toEqual([]);
  });
});
