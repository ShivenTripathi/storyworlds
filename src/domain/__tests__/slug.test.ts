import { describe, expect, it } from "vitest";
import { dedupeSlug, slugifyEntity } from "../entities/slug";

describe("slugifyEntity", () => {
  it("strips diacritics", () => {
    expect(slugifyEntity("character", "Chloé")).toBe("char:chloe");
  });

  it("handles apostrophes and punctuation", () => {
    expect(slugifyEntity("object", "Muad'Dib")).toBe("obj:muad-dib");
  });

  it("caps long names at 60 characters", () => {
    const slug = slugifyEntity("location", "a".repeat(200));
    const [, body] = slug.split(":");
    expect(body.length).toBeLessThanOrEqual(60);
    expect(slug.startsWith("loc:")).toBe(true);
  });

  it("falls back to unnamed when nothing usable remains", () => {
    expect(slugifyEntity("character", "")).toBe("char:unnamed");
    expect(slugifyEntity("faction", "???")).toBe("fac:unnamed");
  });

  it("uses the correct kind prefix", () => {
    expect(slugifyEntity("character", "Paul Atreides")).toBe(
      "char:paul-atreides",
    );
    expect(slugifyEntity("location", "Arrakeen")).toBe("loc:arrakeen");
    expect(slugifyEntity("object", "Crysknife")).toBe("obj:crysknife");
    expect(slugifyEntity("faction", "Bene Gesserit")).toBe("fac:bene-gesserit");
  });
});

describe("dedupeSlug", () => {
  it("returns the slug unchanged when free", () => {
    expect(dedupeSlug("char:paul", new Set())).toBe("char:paul");
  });

  it("appends -2, -3, ... until free", () => {
    const taken = new Set(["char:paul", "char:paul-2"]);
    expect(dedupeSlug("char:paul", taken)).toBe("char:paul-3");
  });

  it("appends -2 on first collision", () => {
    const taken = new Set(["char:paul"]);
    expect(dedupeSlug("char:paul", taken)).toBe("char:paul-2");
  });
});
