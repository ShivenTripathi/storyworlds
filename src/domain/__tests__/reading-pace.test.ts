import { describe, expect, it } from "vitest";
import {
  DEFAULT_WPM,
  estimateTimeLeft,
  formatMinutes,
} from "@/domain/reading-pace";

describe("estimateTimeLeft", () => {
  const wordCounts = [250, 250, 250, 250, 250, 250, 250, 250, 250, 250]; // 10 chunks, 250 words each
  const chapters = [0, 4, 8]; // chapter breaks at chunks 0, 4, 8

  it("counts the current chunk toward both remaining totals", () => {
    const est = estimateTimeLeft(0, 10, wordCounts, chapters, 250);
    // chunk 0 through 3 (next chapter starts at 4): 4 * 250 = 1000 words
    expect(est.wordsToNextChapter).toBe(1000);
    expect(est.minutesToNextChapter).toBe(4);
    // chunk 0 through 9: 2500 words
    expect(est.wordsToEnd).toBe(2500);
    expect(est.minutesToEnd).toBe(10);
  });

  it("finds the nearest chapter break ahead of the current position", () => {
    const est = estimateTimeLeft(5, 10, wordCounts, chapters, 250);
    // next chapter at 8: chunks 5,6,7 = 750 words
    expect(est.wordsToNextChapter).toBe(750);
  });

  it("returns null for wordsToNextChapter once in the last chapter", () => {
    const est = estimateTimeLeft(9, 10, wordCounts, chapters, 250);
    expect(est.wordsToNextChapter).toBeNull();
    expect(est.minutesToNextChapter).toBeNull();
    expect(est.wordsToEnd).toBe(250);
  });

  it("returns null for wordsToNextChapter when no headings were detected", () => {
    const est = estimateTimeLeft(2, 10, wordCounts, [], 250);
    expect(est.wordsToNextChapter).toBeNull();
  });

  it("treats missing wordCounts entries as zero rather than throwing", () => {
    const est = estimateTimeLeft(0, 3, [100], [], 250);
    expect(est.wordsToEnd).toBe(100);
  });

  it("uses the default WPM when none is given", () => {
    const est = estimateTimeLeft(0, 10, wordCounts, [], undefined);
    expect(est.minutesToEnd).toBe(Math.round(2500 / DEFAULT_WPM));
  });

  it("never reports zero minutes for a nonzero word count", () => {
    const est = estimateTimeLeft(9, 10, [1], chapters, 250);
    expect(est.minutesToEnd).toBeGreaterThanOrEqual(1);
  });
});

describe("formatMinutes", () => {
  it("formats sub-hour durations as 'X min'", () => {
    expect(formatMinutes(1)).toBe("1 min");
    expect(formatMinutes(45)).toBe("45 min");
  });

  it("formats whole hours without a minutes suffix", () => {
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(120)).toBe("2h");
  });

  it("formats hour-plus-minutes durations", () => {
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(135)).toBe("2h 15m");
  });
});
