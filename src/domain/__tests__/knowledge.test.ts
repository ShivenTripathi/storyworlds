import { describe, expect, it } from "vitest";
import { frontierFilter } from "../knowledge";

describe("frontierFilter", () => {
  it("keeps items introduced at or before the frontier", () => {
    const items = [
      { id: "a", introducedAtChunk: 0 },
      { id: "b", introducedAtChunk: 5 },
      { id: "c", introducedAtChunk: 10 },
    ];
    expect(frontierFilter(items, 5).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("excludes items introduced after the frontier", () => {
    const items = [{ id: "a", introducedAtChunk: 10 }];
    expect(frontierFilter(items, 5)).toEqual([]);
  });

  it("is null-safe: null/undefined introducedAtChunk is always visible", () => {
    const items = [
      { id: "a", introducedAtChunk: null },
      { id: "b", introducedAtChunk: undefined },
      { id: "c", introducedAtChunk: 999 },
    ];
    expect(frontierFilter(items, 0).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(frontierFilter([], 5)).toEqual([]);
  });
});
