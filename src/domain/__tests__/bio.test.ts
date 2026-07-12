import { describe, expect, it } from "vitest";
import { assembleBio } from "../bio";

describe("assembleBio", () => {
  it("joins multiple fragments into one flowing paragraph", () => {
    const result = assembleBio([
      "Paul Atreides is the young heir of House Atreides",
      "He is quiet and watchful, more comfortable observing than speaking",
    ]);
    expect(result).toBe(
      "Paul Atreides is the young heir of House Atreides. He is quiet and watchful, more comfortable observing than speaking.",
    );
  });

  it("does not double-punctuate a fragment that already ends with terminal punctuation", () => {
    const result = assembleBio([
      "A tense standoff unfolds.",
      "He wonders what comes next?",
    ]);
    expect(result).toBe(
      "A tense standoff unfolds. He wonders what comes next?",
    );
  });

  it("skips null, undefined, and blank fragments", () => {
    const result = assembleBio([
      "The Duke's heir.",
      null,
      undefined,
      "   ",
      "",
    ]);
    expect(result).toBe("The Duke's heir.");
  });

  it("returns null when every fragment is empty", () => {
    expect(assembleBio([null, undefined, "  "])).toBeNull();
  });

  it("returns null for an empty fragment list", () => {
    expect(assembleBio([])).toBeNull();
  });
});
