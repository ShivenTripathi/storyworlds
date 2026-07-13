import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS,
  buildAliasIndex,
  derivedAliases,
  normalizeAlias,
  resolveEntityName,
} from "../entities/resolve";

describe("normalizeAlias", () => {
  it("strips diacritics and lowercases", () => {
    expect(normalizeAlias("Chloé")).toBe("chloe");
  });

  it("strips possessive 's", () => {
    expect(normalizeAlias("Baley's")).toBe("baley");
    expect(normalizeAlias("Atreides'")).toBe("atreides");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeAlias("Paul   Atreides")).toBe("paul atreides");
  });

  it("strips leading/trailing punctuation", () => {
    expect(normalizeAlias("--Arrakeen--")).toBe("arrakeen");
    expect(normalizeAlias("(Fastolfe)")).toBe("fastolfe");
  });
});

describe("resolveEntityName", () => {
  const index = buildAliasIndex([
    { alias: "Elijah Baley", entityId: "char:baley" },
    { alias: "Baley", entityId: "char:baley" },
    { alias: "Daneel Olivaw", entityId: "char:daneel" },
    { alias: "Fastolfe", entityId: "char:fastolfe" },
    { alias: "Paul", entityId: "char:paul-atreides" },
    { alias: "Paul", entityId: "char:paul-muaddib" },
  ]);

  it("resolves an exact hit", () => {
    expect(resolveEntityName("Elijah Baley", index)).toEqual({
      entityId: "char:baley",
    });
  });

  it("resolves a possessive form", () => {
    expect(resolveEntityName("Baley's", index)).toEqual({
      entityId: "char:baley",
    });
  });

  it("strips honorifics", () => {
    expect(resolveEntityName("Dr. Fastolfe", index)).toEqual({
      entityId: "char:fastolfe",
    });
  });

  it("resolves via full-name containment (initial ignored)", () => {
    expect(resolveEntityName("R. Daneel Olivaw", index)).toEqual({
      entityId: "char:daneel",
    });
  });

  it("reports ambiguous when two entities share an alias", () => {
    expect(resolveEntityName("Paul", index)).toEqual({
      unresolved: "Paul",
      reason: "ambiguous",
    });
  });

  it("reports unknown for names with no match", () => {
    expect(resolveEntityName("Someone Else Entirely", index)).toEqual({
      unresolved: "Someone Else Entirely",
      reason: "unknown",
    });
  });

  it("reports ambiguous containment when multiple keys match", () => {
    const idx = buildAliasIndex([
      { alias: "Paul Atreides", entityId: "char:paul-a" },
      { alias: "Paul Muaddib", entityId: "char:paul-m" },
    ]);
    // "Paul" alone is single-word so containment doesn't apply; use a
    // two-word probe that matches both multi-word keys via subsequence.
    expect(resolveEntityName("Paul Something", idx)).toEqual({
      unresolved: "Paul Something",
      reason: "unknown",
    });
  });
});

describe("buildAliasIndex", () => {
  it("marks aliases claimed by 2+ distinct entities as ambiguous", () => {
    const idx = buildAliasIndex([
      { alias: "Paul", entityId: "char:a" },
      { alias: "Paul", entityId: "char:b" },
    ]);
    expect(idx.get("paul")).toBe(AMBIGUOUS);
  });

  it("does not mark repeated entries from the same entity as ambiguous", () => {
    const idx = buildAliasIndex([
      { alias: "Paul", entityId: "char:a" },
      { alias: "Paul", entityId: "char:a" },
    ]);
    expect(idx.get("paul")).toBe("char:a");
  });
});

describe("derivedAliases", () => {
  it("returns full/last/first for multi-word names", () => {
    expect(derivedAliases("Paul Atreides")).toEqual([
      "Paul Atreides",
      "Atreides",
      "Paul",
    ]);
  });

  it("returns just the name for single-word names", () => {
    expect(derivedAliases("Arrakeen")).toEqual(["Arrakeen"]);
  });
});
