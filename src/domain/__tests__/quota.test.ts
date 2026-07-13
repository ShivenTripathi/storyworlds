import { describe, it, expect } from "vitest";
import {
  BACKGROUND_BUDGET,
  canSpend,
  computeQuotaState,
  GEMINI_FREE_TIER_RPD,
  INTERACTIVE_RESERVE,
  splitUsage,
  startOfNextUtcDay,
  startOfUtcDay,
} from "@/domain/quota";

const NOW = new Date("2026-07-13T12:00:00Z");

function state(opts: {
  interactiveUsed?: number;
  backgroundUsed?: number;
  exhaustedUntil?: Date | null;
}) {
  return computeQuotaState({
    interactiveUsed: opts.interactiveUsed ?? 0,
    backgroundUsed: opts.backgroundUsed ?? 0,
    exhaustedUntil: opts.exhaustedUntil ?? null,
  });
}

describe("splitUsage", () => {
  it("splits interactive (has userId) from background (no userId)", () => {
    expect(
      splitUsage([{ userId: "u1" }, { userId: "u1" }, { userId: null }]),
    ).toEqual({ interactiveUsed: 2, backgroundUsed: 1 });
  });
});

describe("canSpend", () => {
  it("background spends freely while its slice remains", () => {
    expect(canSpend("background", state({ backgroundUsed: 0 }), NOW)).toBe(
      true,
    );
    expect(
      canSpend(
        "background",
        state({ backgroundUsed: BACKGROUND_BUDGET - 1 }),
        NOW,
      ),
    ).toBe(true);
  });

  it("background stops at its slice — the interactive reserve is untouchable", () => {
    expect(
      canSpend("background", state({ backgroundUsed: BACKGROUND_BUDGET }), NOW),
    ).toBe(false);
  });

  it("background also stops when the WHOLE day's cap is reached (heavy interactive day)", () => {
    // Background slice not exhausted, but total is at the cap.
    const s = state({
      interactiveUsed: GEMINI_FREE_TIER_RPD - 100,
      backgroundUsed: 100,
    });
    expect(s.backgroundRemaining).toBeGreaterThan(0);
    expect(canSpend("background", s, NOW)).toBe(false);
  });

  it("interactive keeps working even when the background slice is spent", () => {
    expect(
      canSpend(
        "interactive",
        state({ backgroundUsed: BACKGROUND_BUDGET }),
        NOW,
      ),
    ).toBe(true);
  });

  it("a recorded daily exhaustion blocks EVERYONE until it lifts", () => {
    const until = new Date(NOW.getTime() + 60_000);
    expect(canSpend("interactive", state({ exhaustedUntil: until }), NOW)).toBe(
      false,
    );
    expect(canSpend("background", state({ exhaustedUntil: until }), NOW)).toBe(
      false,
    );
    const after = new Date(until.getTime() + 1);
    expect(
      canSpend("interactive", state({ exhaustedUntil: until }), after),
    ).toBe(true);
  });
});

describe("quota constants + day math", () => {
  it("reserve + background budget = the real 500/day cap", () => {
    expect(INTERACTIVE_RESERVE + BACKGROUND_BUDGET).toBe(GEMINI_FREE_TIER_RPD);
    expect(INTERACTIVE_RESERVE).toBe(50);
  });

  it("startOfNextUtcDay is the daily reset boundary", () => {
    expect(startOfUtcDay(NOW).toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(startOfNextUtcDay(NOW).toISOString()).toBe(
      "2026-07-14T00:00:00.000Z",
    );
  });
});
