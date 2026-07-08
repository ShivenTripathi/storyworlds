import { describe, expect, it } from "vitest";
import { OverlaySchema } from "../schemas";

describe("OverlaySchema", () => {
  it("parses a fully-populated valid payload", () => {
    const payload = {
      sceneDescription: "Paul stands atop a dune, stillsuit hood thrown back.",
      activeEntities: [{ name: "Paul Atreides" }, { name: "Chani" }],
      mood: "tense anticipation",
      interpretiveNotes: "Echoes the earlier desert-crossing motif.",
      suggestedQuestions: ["What are you afraid of?", "Why did you come here?"],
    };
    const result = OverlaySchema.parse(payload);
    expect(result.sceneDescription).toBe(payload.sceneDescription);
    expect(result.activeEntities).toEqual([{ name: "Paul Atreides" }, { name: "Chani" }]);
    expect(result.mood).toBe("tense anticipation");
    expect(result.suggestedQuestions).toEqual(payload.suggestedQuestions);
  });

  it("applies defaults for optional/array fields", () => {
    const result = OverlaySchema.parse({
      sceneDescription: "A quiet room at dusk.",
    });
    expect(result.activeEntities).toEqual([]);
    expect(result.suggestedQuestions).toEqual([]);
    expect(result.mood).toBeUndefined();
    expect(result.interpretiveNotes).toBeUndefined();
  });

  it("trims suggestedQuestions to a maximum of 3 rather than rejecting", () => {
    const result = OverlaySchema.parse({
      sceneDescription: "A crowded market square.",
      suggestedQuestions: ["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"],
    });
    expect(result.suggestedQuestions).toHaveLength(3);
    expect(result.suggestedQuestions).toEqual(["Q1?", "Q2?", "Q3?"]);
  });

  it("rejects a missing sceneDescription", () => {
    expect(() =>
      OverlaySchema.parse({ activeEntities: [{ name: "Chani" }] }),
    ).toThrow();
  });

  it("rejects an empty-string sceneDescription", () => {
    expect(() => OverlaySchema.parse({ sceneDescription: "" })).toThrow();
  });

  it("rejects an activeEntities entry missing a name", () => {
    expect(() =>
      OverlaySchema.parse({
        sceneDescription: "Some scene.",
        activeEntities: [{}],
      }),
    ).toThrow();
  });
});
