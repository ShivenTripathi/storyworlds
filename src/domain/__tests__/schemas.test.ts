import { describe, expect, it } from "vitest";
import {
  SegmentAnalysisSchema,
  WorldSynthesisSchema,
  pageToChunkIdx,
} from "../schemas";

describe("SegmentAnalysisSchema", () => {
  it("parses a valid payload", () => {
    const payload = {
      entities: [
        {
          name: "Paul Atreides",
          kind: "character",
          aliases: ["Muad'Dib"],
          description: "The protagonist.",
          visualDescription: "Grey eyes, stillsuit.",
          firstSeenPage: 3,
        },
      ],
      events: [{ summary: "Paul meets the Fremen.", page: 12 }],
      settingNotes: "Desert planet Arrakis.",
    };
    const result = SegmentAnalysisSchema.parse(payload);
    expect(result.entities[0].name).toBe("Paul Atreides");
  });

  it("applies default empty aliases", () => {
    const result = SegmentAnalysisSchema.parse({
      entities: [
        { name: "Chani", kind: "character", description: "A Fremen." },
      ],
      events: [],
    });
    expect(result.entities[0].aliases).toEqual([]);
  });

  it("rejects an entity missing a name", () => {
    expect(() =>
      SegmentAnalysisSchema.parse({
        entities: [{ kind: "character", description: "no name" }],
        events: [],
      }),
    ).toThrow();
  });

  it("rejects an entity with an empty-string name", () => {
    expect(() =>
      SegmentAnalysisSchema.parse({
        entities: [{ name: "", kind: "character", description: "empty" }],
        events: [],
      }),
    ).toThrow();
  });

  it("rejects an unknown entity kind", () => {
    expect(() =>
      SegmentAnalysisSchema.parse({
        entities: [{ name: "Thing", kind: "vehicle", description: "bad kind" }],
        events: [],
      }),
    ).toThrow();
  });
});

describe("WorldSynthesisSchema", () => {
  const validPayload = {
    settingDescription: "A desert world.",
    blurb: "A young heir is thrust into a desert world of shifting loyalties.",
    visualStyle: {
      artStyle: "painterly",
      colorPalette: "ochre and rust",
      mood: "tense",
      eraSetting: "far future",
      themeArchetype: "desert-epic",
    },
    entities: [
      {
        name: "Paul Atreides",
        kind: "character",
        aliases: ["Muad'Dib"],
        attributes: { role: "protagonist" },
        introducedAtPage: 1,
      },
    ],
  };

  it("parses a valid payload with defaults applied", () => {
    const result = WorldSynthesisSchema.parse(validPayload);
    expect(result.timeline).toEqual([]);
    expect(result.commitments).toEqual([]);
    expect(result.unknowns).toEqual([]);
  });

  it("defaults commitment status to 'open'", () => {
    const result = WorldSynthesisSchema.parse({
      ...validPayload,
      commitments: [{ claim: "The prophecy will be fulfilled." }],
    });
    expect(result.commitments[0].status).toBe("open");
  });

  it("rejects an invalid theme archetype", () => {
    expect(() =>
      WorldSynthesisSchema.parse({
        ...validPayload,
        visualStyle: {
          ...validPayload.visualStyle,
          themeArchetype: "cyberpunk",
        },
      }),
    ).toThrow();
  });

  it("rejects a missing settingDescription", () => {
    const { settingDescription: _dropped, ...rest } = validPayload;
    expect(() => WorldSynthesisSchema.parse(rest)).toThrow();
  });

  it("rejects a missing blurb", () => {
    const { blurb: _dropped, ...rest } = validPayload;
    expect(() => WorldSynthesisSchema.parse(rest)).toThrow();
  });

  it("accepts an optional entity attributes.description", () => {
    const result = WorldSynthesisSchema.parse({
      ...validPayload,
      entities: [
        {
          ...validPayload.entities[0],
          attributes: {
            ...validPayload.entities[0].attributes,
            description:
              "Paul Atreides is introduced as the studious heir of House Atreides.",
          },
        },
      ],
    });
    expect(result.entities[0].attributes.description).toBe(
      "Paul Atreides is introduced as the studious heir of House Atreides.",
    );
  });
});

describe("pageToChunkIdx", () => {
  it("converts 1-based page to 0-based chunk index", () => {
    expect(pageToChunkIdx(1)).toBe(0);
    expect(pageToChunkIdx(12)).toBe(11);
  });
});
