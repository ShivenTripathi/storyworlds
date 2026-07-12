import { describe, expect, it } from "vitest";
import { buildCoverPrompt } from "../cover";

describe("buildCoverPrompt", () => {
  it("includes the title and author", () => {
    const prompt = buildCoverPrompt({
      title: "Dune",
      author: "Frank Herbert",
      visualStyle: {
        artStyle: "painterly",
        colorPalette: "ochre and cobalt",
        mood: "epic, austere",
        eraSetting: "far-future desert empire",
      },
      themeArchetype: "desert-epic",
    });

    expect(prompt).toContain('"Dune"');
    expect(prompt).toContain("by Frank Herbert");
    expect(prompt).toContain("painterly");
    expect(prompt).toContain("ochre and cobalt");
    expect(prompt).toContain("epic, austere");
    expect(prompt).toContain("far-future desert empire");
  });

  it("omits the byline when there is no author", () => {
    const prompt = buildCoverPrompt({
      title: "Untitled Manuscript",
      visualStyle: null,
      themeArchetype: null,
    });

    expect(prompt).not.toContain(" by ");
    expect(prompt).toContain('"Untitled Manuscript"');
  });

  it("falls back to the archetype's mood description when visualStyle is empty", () => {
    const withArchetype = buildCoverPrompt({
      title: "The Long Watch",
      visualStyle: null,
      themeArchetype: "gothic",
    });

    expect(withArchetype).toContain("Candlelit stone and old blood");
  });

  it("falls back to a generic style line when there is no visualStyle or archetype match", () => {
    const prompt = buildCoverPrompt({
      title: "The Long Watch",
      visualStyle: {},
      themeArchetype: "not-a-real-archetype",
    });

    expect(prompt).toContain("evocative, atmospheric, genre-appropriate");
  });

  it("ignores blank/whitespace-only visualStyle fields", () => {
    const prompt = buildCoverPrompt({
      title: "The Long Watch",
      visualStyle: {
        artStyle: "  ",
        colorPalette: "",
        mood: undefined,
        eraSetting: null,
      },
      themeArchetype: null,
    });

    expect(prompt).toContain("evocative, atmospheric, genre-appropriate");
  });

  it("never mentions entities, events, or plot — only title/author/style inputs", () => {
    const prompt = buildCoverPrompt({
      title: "Spoiler Test",
      author: "A. Writer",
      visualStyle: {
        artStyle: "ink wash",
        colorPalette: "monochrome",
        mood: "melancholy",
        eraSetting: "Victorian London",
      },
      themeArchetype: "gothic",
    });

    // The function's type signature has no entity/plot inputs at all, so
    // this is really a smoke test that the instructional text stays intact.
    expect(prompt).toMatch(/not a specific scene or plot event/i);
    expect(prompt).toMatch(/no readable text or lettering, no title/i);
  });

  it("mentions no text/logos/title-lettering instruction for a clean cover", () => {
    const prompt = buildCoverPrompt({
      title: "Anything",
      visualStyle: null,
      themeArchetype: null,
    });
    expect(prompt).toMatch(/no logos/i);
  });
});
