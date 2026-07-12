import { describe, expect, it } from "vitest";
import {
  nextMissingOverlayChunks,
  selectNextBookForOverlays,
  type OverlayBacklogBook,
} from "../overlay-gap";

function book(
  overrides: Partial<OverlayBacklogBook> & { bookId: string },
): OverlayBacklogBook {
  return {
    createdAt: new Date("2026-07-01T00:00:00Z"),
    catalogSource: null,
    visibility: "private",
    pricingTier: "private_premium",
    totalChunks: 100,
    readyOverlayCount: 0,
    ...overrides,
  };
}

describe("selectNextBookForOverlays", () => {
  it("returns null when there are no candidates", () => {
    expect(selectNextBookForOverlays([])).toBeNull();
  });

  it("skips a fully-illustrated book", () => {
    const result = selectNextBookForOverlays([
      book({ bookId: "done", totalChunks: 50, readyOverlayCount: 50 }),
      book({ bookId: "gap", totalChunks: 50, readyOverlayCount: 10 }),
    ]);
    expect(result).toBe("gap");
  });

  it("prioritizes catalog/published backlogs over private ones", () => {
    const result = selectNextBookForOverlays([
      book({ bookId: "priv", readyOverlayCount: 0 }),
      book({
        bookId: "cat",
        catalogSource: "gutenberg:1",
        readyOverlayCount: 0,
      }),
    ]);
    expect(result).toBe("cat");
  });

  it("picks the oldest backlog within a tier", () => {
    const result = selectNextBookForOverlays([
      book({ bookId: "newer", createdAt: new Date("2026-07-05T00:00:00Z") }),
      book({ bookId: "older", createdAt: new Date("2026-07-01T00:00:00Z") }),
    ]);
    expect(result).toBe("older");
  });

  it("ignores a book with totalChunks of zero (nothing to illustrate)", () => {
    const result = selectNextBookForOverlays([
      book({ bookId: "empty", totalChunks: 0, readyOverlayCount: 0 }),
    ]);
    expect(result).toBeNull();
  });
});

describe("nextMissingOverlayChunks", () => {
  it("returns the first batchSize missing indices in ascending order", () => {
    const result = nextMissingOverlayChunks(10, [0, 1, 2, 5], 3);
    expect(result).toEqual([3, 4, 6]);
  });

  it("returns fewer than batchSize when few pages remain", () => {
    const result = nextMissingOverlayChunks(5, [0, 1, 2, 3], 4);
    expect(result).toEqual([4]);
  });

  it("returns an empty array when everything is already ready", () => {
    const result = nextMissingOverlayChunks(3, [0, 1, 2], 4);
    expect(result).toEqual([]);
  });

  it("is resumable: re-running with the previous batch marked ready advances the frontier", () => {
    const firstBatch = nextMissingOverlayChunks(10, [], 3);
    expect(firstBatch).toEqual([0, 1, 2]);
    const secondBatch = nextMissingOverlayChunks(10, firstBatch, 3);
    expect(secondBatch).toEqual([3, 4, 5]);
  });
});
