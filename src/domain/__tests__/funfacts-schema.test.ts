import { describe, expect, it } from "vitest";
import { FunFactsSchema } from "../schemas";

describe("FunFactsSchema", () => {
  it("parses a fully-populated valid payload", () => {
    const payload = {
      facts: [
        {
          text: "The author wrote the first draft in a single winter.",
          category: "author",
        },
        {
          text: "It was first serialized in a magazine before appearing as a book.",
          category: "history",
        },
        {
          text: "Its working title was completely different from the final one.",
          category: "trivia",
        },
        {
          text: "It has been adapted for film multiple times.",
          category: "legacy",
        },
      ],
    };
    const result = FunFactsSchema.parse(payload);
    expect(result.facts).toHaveLength(4);
    expect(result.facts[0].category).toBe("author");
    expect(result.facts[3].category).toBe("legacy");
  });

  it("defaults facts to an empty array when omitted", () => {
    const result = FunFactsSchema.parse({});
    expect(result.facts).toEqual([]);
  });

  it("accepts an empty facts array — conservatism over fabrication is a valid result", () => {
    const result = FunFactsSchema.parse({ facts: [] });
    expect(result.facts).toEqual([]);
  });

  it("trims facts beyond the maximum of 6 rather than rejecting", () => {
    const facts = Array.from({ length: 9 }, (_, i) => ({
      text: `Fact number ${i + 1}.`,
      category: "trivia" as const,
    }));
    const result = FunFactsSchema.parse({ facts });
    expect(result.facts).toHaveLength(6);
    expect(result.facts[0].text).toBe("Fact number 1.");
    expect(result.facts[5].text).toBe("Fact number 6.");
  });

  it("rejects a fact with an empty text", () => {
    expect(() =>
      FunFactsSchema.parse({ facts: [{ text: "", category: "trivia" }] }),
    ).toThrow();
  });

  it("rejects a fact with an unknown category", () => {
    expect(() =>
      FunFactsSchema.parse({
        facts: [{ text: "Some fact.", category: "spoiler" }],
      }),
    ).toThrow();
  });

  it("rejects a fact missing its category", () => {
    expect(() =>
      FunFactsSchema.parse({ facts: [{ text: "Some fact." }] }),
    ).toThrow();
  });
});
