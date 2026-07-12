import { describe, expect, it } from "vitest";
import { classifyPriorityTier, sortByPriority } from "../priority";

describe("classifyPriorityTier", () => {
  it("classifies a catalogSource book as catalog regardless of other fields", () => {
    expect(
      classifyPriorityTier({
        catalogSource: "gutenberg:84",
        visibility: "private",
        pricingTier: "private_premium",
      }),
    ).toBe("catalog");
  });

  it("classifies a published book with no catalogSource as published", () => {
    expect(
      classifyPriorityTier({
        catalogSource: null,
        visibility: "published",
        pricingTier: null,
      }),
    ).toBe("published");
  });

  it("classifies public_subsidized pricing as published even if visibility lags", () => {
    expect(
      classifyPriorityTier({
        catalogSource: null,
        visibility: "private",
        pricingTier: "public_subsidized",
      }),
    ).toBe("published");
  });

  it("classifies everything else as private", () => {
    expect(
      classifyPriorityTier({
        catalogSource: null,
        visibility: "private",
        pricingTier: "private_premium",
      }),
    ).toBe("private");
  });
});

describe("sortByPriority", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, n));

  it("orders catalog before published before private", () => {
    const result = sortByPriority([
      { bookId: "private-1", tier: "private", createdAt: day(1) },
      { bookId: "catalog-1", tier: "catalog", createdAt: day(3) },
      { bookId: "published-1", tier: "published", createdAt: day(2) },
    ]);
    expect(result.map((b) => b.bookId)).toEqual([
      "catalog-1",
      "published-1",
      "private-1",
    ]);
  });

  it("orders oldest-first within a tier", () => {
    const result = sortByPriority([
      { bookId: "newer", tier: "catalog", createdAt: day(10) },
      { bookId: "older", tier: "catalog", createdAt: day(1) },
      { bookId: "middle", tier: "catalog", createdAt: day(5) },
    ]);
    expect(result.map((b) => b.bookId)).toEqual(["older", "middle", "newer"]);
  });

  it("does not mutate its input array", () => {
    const input = [
      { bookId: "a", tier: "private" as const, createdAt: day(2) },
      { bookId: "b", tier: "catalog" as const, createdAt: day(1) },
    ];
    const copy = [...input];
    sortByPriority(input);
    expect(input).toEqual(copy);
  });
});
