import { describe, it, expect } from "vitest";
import { formatChunk, reflowProse, splitDropCap } from "@/domain/reader-format";

function paraText(block: ReturnType<typeof formatChunk>[number]): string {
  if (block.kind !== "para")
    throw new Error("expected para, got " + block.kind);
  return block.runs.map((r) => r.text).join("");
}

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

describe("reflowProse — messy PDF/OCR extraction", () => {
  // One line per visual line, no blank lines between paragraphs, plus a broken
  // word at the wrap — exactly what a PDF text layer produces.
  const raw =
    "YEAR OF GLAD\n" +
    "I am seated in an office, surrounded by heads and bodies. My posture is\n" +
    "consciously congruent to the shape of my hard chair, insulated from the\n" +
    "reception area outside.\n" +
    "I am in here.\n" +
    "Three faces have resolved above summer-weight sportcoats and half-\n" +
    "Windsors across a polished pine conference table under an Arizona noon.";

  it("de-hyphenates a compound wrapped at its hyphen (keeps the hyphen)", () => {
    expect(reflowProse(raw)).toContain("half-Windsors");
    expect(reflowProse(raw)).not.toContain("half- ");
  });

  it("de-hyphenates a single word split across a line break (drops the hyphen)", () => {
    expect(reflowProse("the inter-\nview room was cold")).toBe(
      "the interview room was cold",
    );
  });

  it("infers paragraph breaks where a line stops short of the column", () => {
    const blocks = formatChunk(raw);
    // The short lines become their own paragraphs; long lines are joined.
    expect(paraText(blocks[1])).toContain(
      "My posture is consciously congruent",
    );
    expect(
      blocks.some((b) => b.kind === "para" && paraText(b) === "I am in here."),
    ).toBe(true);
  });

  it("lifts an inline ALL-CAPS section title out of the run-on paragraph", () => {
    const blocks = formatChunk(raw);
    expect(blocks[0]).toMatchObject({ kind: "display", text: "YEAR OF GLAD" });
  });

  it("does not mistake a first-person sentence for a roman-numeral heading", () => {
    const blocks = formatChunk("I am in here.\n\nThe day was long.");
    expect(blocks[0].kind).toBe("para");
    expect(paraText(blocks[0])).toBe("I am in here.");
  });

  it("preserves existing blank-line paragraphs and is idempotent on clean text", () => {
    const clean = "First paragraph here.\n\nSecond paragraph here.";
    expect(reflowProse(clean)).toBe(clean);
    expect(reflowProse(reflowProse(raw))).toBe(reflowProse(raw));
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
