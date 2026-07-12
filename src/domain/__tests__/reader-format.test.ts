import { describe, it, expect } from "vitest";
import { formatChunk, splitDropCap } from "@/domain/reader-format";

describe("formatChunk", () => {
  it("renders _italic_ spans as italic runs", () => {
    const [block] = formatChunk("He was _very_ tired.");
    expect(block).toMatchObject({ kind: "para" });
    if (block.kind !== "para") throw new Error("expected para");
    expect(block.runs).toEqual([
      { text: "He was " },
      { text: "very", italic: true },
      { text: " tired." },
    ]);
  });

  it("unwraps editorial brackets around italics", () => {
    const [block] = formatChunk("[_All rights reserved._]");
    if (block.kind !== "para") throw new Error("expected para");
    // Brackets gone; content italicized.
    expect(
      block.runs.some((r) => r.italic && r.text.includes("All rights")),
    ).toBe(true);
    expect(block.runs.map((r) => r.text).join("")).not.toContain("[");
  });

  it("treats short all-caps lines as centered display lines", () => {
    const blocks = formatChunk("DRACULA\n\nNEW YORK\n\nGROSSET & DUNLAP");
    expect(blocks[0]).toEqual({
      kind: "display",
      level: "title",
      text: "DRACULA",
    });
    expect(blocks[1]).toMatchObject({ kind: "display" });
    expect(blocks[2]).toMatchObject({ kind: "display" });
  });

  it("turns [Illustration: …] into an ornament block", () => {
    const [block] = formatChunk("[Illustration: colophon]");
    expect(block).toEqual({ kind: "illustration", caption: "colophon" });
  });

  it("recognizes chapter headings and drop-caps the following paragraph", () => {
    const blocks = formatChunk(
      "CHAPTER I\n\nJonathan Harker's Journal kept in shorthand.",
    );
    expect(blocks[0]).toMatchObject({ kind: "heading" });
    expect(blocks[1]).toMatchObject({ kind: "para", dropCap: true });
  });

  it("does not drop-cap ordinary mid-text paragraphs", () => {
    const blocks = formatChunk("A plain sentence.\n\nAnother plain sentence.");
    expect(blocks.every((b) => b.kind !== "para" || !b.dropCap)).toBe(true);
  });

  it("parses a run-together table of contents into entries", () => {
    const [block] = formatChunk(
      "I. A Scandal in Bohemia II. The Red-Headed League III. A Case of Identity IV. The Boscombe Valley Mystery",
    );
    expect(block.kind).toBe("toc");
    if (block.kind !== "toc") throw new Error("expected toc");
    expect(block.entries).toHaveLength(4);
    expect(block.entries[0]).toEqual({
      marker: "I",
      title: "A Scandal in Bohemia",
    });
    expect(block.entries[3].title).toBe("The Boscombe Valley Mystery");
  });

  it("marks a bare roman-numeral line as a section (no drop cap after)", () => {
    const blocks = formatChunk(
      "I.\n\nTo Sherlock Holmes she is always the woman.",
    );
    expect(blocks[0]).toMatchObject({ kind: "heading", section: true });
    // A bare section number does not open a chapter, so no drop cap.
    expect(blocks[1]).toMatchObject({ kind: "para" });
    expect((blocks[1] as { dropCap?: boolean }).dropCap).toBeUndefined();
  });
});

describe("splitDropCap", () => {
  it("extracts the first letter, leaving the rest", () => {
    const res = splitDropCap([{ text: "Jonathan went home." }]);
    expect(res?.cap).toBe("J");
    expect(res?.rest.map((r) => r.text).join("")).toBe("onathan went home.");
  });

  it("skips leading whitespace but refuses to cap punctuation", () => {
    expect(splitDropCap([{ text: "  Hello" }])?.cap).toBe("H");
    expect(splitDropCap([{ text: '"Quoted"' }])).toBeNull();
  });
});
