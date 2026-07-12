import { describe, it, expect } from "vitest";
import {
  computeStreaks,
  forwardReadRange,
  utcDayString,
  addUtcDays,
} from "@/domain/streak";

describe("addUtcDays / utcDayString", () => {
  it("adds and subtracts UTC calendar days without local-timezone drift", () => {
    expect(addUtcDays("2026-01-01", 1)).toBe("2026-01-02");
    expect(addUtcDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addUtcDays("2026-03-01", -1)).toBe("2026-02-28"); // non-leap Feb
    expect(addUtcDays("2024-03-01", -1)).toBe("2024-02-29"); // leap Feb
  });

  it("formats a Date as its UTC calendar day", () => {
    expect(utcDayString(new Date("2026-07-08T23:59:00Z"))).toBe("2026-07-08");
  });
});

describe("computeStreaks", () => {
  it("returns all zeros for an empty list", () => {
    expect(computeStreaks([])).toEqual({
      currentStreakDays: 0,
      longestStreakDays: 0,
      activeDays: 0,
    });
  });

  it("returns all zeros when every day has wordsRead 0", () => {
    const days = [
      { day: "2026-07-06", wordsRead: 0 },
      { day: "2026-07-07", wordsRead: 0 },
    ];
    expect(computeStreaks(days, "2026-07-08")).toEqual({
      currentStreakDays: 0,
      longestStreakDays: 0,
      activeDays: 0,
    });
  });

  it("handles a single active day counted as today", () => {
    const days = [{ day: "2026-07-08", wordsRead: 500 }];
    expect(computeStreaks(days, "2026-07-08")).toEqual({
      currentStreakDays: 1,
      longestStreakDays: 1,
      activeDays: 1,
    });
  });

  it("handles gaps — breaks the run across a missing day", () => {
    const days = [
      { day: "2026-07-01", wordsRead: 100 },
      { day: "2026-07-02", wordsRead: 100 },
      // gap on 07-03
      { day: "2026-07-04", wordsRead: 100 },
    ];
    const result = computeStreaks(days, "2026-07-10");
    expect(result.activeDays).toBe(3);
    expect(result.longestStreakDays).toBe(2); // 07-01, 07-02
    expect(result.currentStreakDays).toBe(0); // long lapsed by 07-10
  });

  it("handles gaps represented as explicit zero-wordsRead rows the same as missing rows", () => {
    const days = [
      { day: "2026-07-01", wordsRead: 100 },
      { day: "2026-07-02", wordsRead: 100 },
      { day: "2026-07-03", wordsRead: 0 },
      { day: "2026-07-04", wordsRead: 100 },
    ];
    const result = computeStreaks(days, "2026-07-10");
    expect(result.longestStreakDays).toBe(2);
  });

  it("distinguishes current streak from a longer historical streak", () => {
    const days = [
      { day: "2026-06-01", wordsRead: 50 },
      { day: "2026-06-02", wordsRead: 50 },
      { day: "2026-06-03", wordsRead: 50 },
      { day: "2026-06-04", wordsRead: 50 },
      { day: "2026-06-05", wordsRead: 50 }, // 5-day historical streak
      // gap
      { day: "2026-07-07", wordsRead: 50 },
      { day: "2026-07-08", wordsRead: 50 }, // 2-day current streak
    ];
    const result = computeStreaks(days, "2026-07-08");
    expect(result.longestStreakDays).toBe(5);
    expect(result.currentStreakDays).toBe(2);
    expect(result.activeDays).toBe(7);
  });

  it("counts the current streak from yesterday when today has no activity yet", () => {
    const days = [
      { day: "2026-07-06", wordsRead: 50 },
      { day: "2026-07-07", wordsRead: 50 }, // yesterday relative to "today"
    ];
    const result = computeStreaks(days, "2026-07-08");
    expect(result.currentStreakDays).toBe(2);
  });

  it("treats the streak as lapsed once neither today nor yesterday is active", () => {
    const days = [
      { day: "2026-07-05", wordsRead: 50 },
      { day: "2026-07-06", wordsRead: 50 },
    ];
    const result = computeStreaks(days, "2026-07-08"); // gap of 2 days before "today"
    expect(result.currentStreakDays).toBe(0);
    expect(result.longestStreakDays).toBe(2);
  });

  it("is unaffected by out-of-order input (sorts internally)", () => {
    const days = [
      { day: "2026-07-08", wordsRead: 10 },
      { day: "2026-07-06", wordsRead: 10 },
      { day: "2026-07-07", wordsRead: 10 },
    ];
    const result = computeStreaks(days, "2026-07-08");
    expect(result.currentStreakDays).toBe(3);
    expect(result.longestStreakDays).toBe(3);
  });
});

describe("forwardReadRange", () => {
  it("returns null when the frontier doesn't move forward (re-read / same position)", () => {
    expect(forwardReadRange(5, 5)).toBeNull();
    expect(forwardReadRange(5, 3)).toBeNull();
  });

  it("returns the newly-read range on forward movement", () => {
    expect(forwardReadRange(5, 8)).toEqual({ fromIdx: 6, toIdx: 8 });
  });

  it("counts chunk 0 as newly read when there's no prior progress (-1 sentinel)", () => {
    expect(forwardReadRange(-1, 0)).toEqual({ fromIdx: 0, toIdx: 0 });
  });

  it("handles a single-chunk forward step", () => {
    expect(forwardReadRange(10, 11)).toEqual({ fromIdx: 11, toIdx: 11 });
  });
});
