import { describe, it, expect } from "vitest";
import {
  cardState,
  prominenceScore,
  rarityFromScore,
  DEFAULT_REVEAL_BUFFER_CHUNKS,
} from "@/domain/codex";

describe("cardState — fail-closed frontier gate", () => {
  it("owner/admin (null frontier) sees every card as known", () => {
    expect(cardState(null, null)).toBe("known");
    expect(cardState(999, null)).toBe("known");
  });

  it("locks an entity introduced ahead of the frontier", () => {
    expect(cardState(50, 10)).toBe("locked");
  });

  it("locks an entity with an unknown introduction point (fail closed)", () => {
    expect(cardState(null, 10)).toBe("locked");
  });

  it("is 'met' from introduction until the reveal buffer elapses", () => {
    expect(cardState(10, 10)).toBe("met");
    expect(cardState(10, 10 + DEFAULT_REVEAL_BUFFER_CHUNKS - 1)).toBe("met");
  });

  it("becomes 'known' once the reader is past the reveal buffer", () => {
    expect(cardState(10, 10 + DEFAULT_REVEAL_BUFFER_CHUNKS)).toBe("known");
    expect(cardState(0, 500)).toBe("known");
  });

  it("treats frontier 0 (just started) as a real position, not owner view", () => {
    // A reader at chunk 0 has met only entities introduced at chunk 0.
    expect(cardState(0, 0)).toBe("met");
    expect(cardState(1, 0)).toBe("locked");
  });
});

describe("prominenceScore + rarityFromScore", () => {
  const totalChunks = 100;

  it("ranks a protagonist above a minor character", () => {
    const protagonist = prominenceScore({
      pageCount: 80,
      relationshipDegree: 8,
      chatCount: 15,
      totalChunks,
    });
    const minor = prominenceScore({
      pageCount: 2,
      relationshipDegree: 1,
      chatCount: 0,
      totalChunks,
    });
    expect(protagonist).toBeGreaterThan(minor);
    expect(rarityFromScore(protagonist)).toBe("legendary");
    expect(rarityFromScore(minor)).toBe("common");
  });

  it("stays within 0..1 and handles degenerate input", () => {
    expect(
      prominenceScore({
        pageCount: 0,
        relationshipDegree: 0,
        chatCount: 0,
        totalChunks: 0,
      }),
    ).toBe(0);
    const maxed = prominenceScore({
      pageCount: 1000,
      relationshipDegree: 100,
      chatCount: 100,
      totalChunks: 100,
    });
    expect(maxed).toBeLessThanOrEqual(1);
    expect(maxed).toBeGreaterThan(0.9);
  });

  it("maps the rarity tiers in ascending order", () => {
    expect(rarityFromScore(0)).toBe("common");
    expect(rarityFromScore(0.2)).toBe("rare");
    expect(rarityFromScore(0.4)).toBe("epic");
    expect(rarityFromScore(0.8)).toBe("legendary");
  });

  it("lets chat engagement nudge but not dominate rarity", () => {
    // Pure chat spam on a background character can't mint a legendary.
    const chatSpamOnExtra = prominenceScore({
      pageCount: 1,
      relationshipDegree: 0,
      chatCount: 100,
      totalChunks,
    });
    expect(rarityFromScore(chatSpamOnExtra)).not.toBe("legendary");
  });
});
