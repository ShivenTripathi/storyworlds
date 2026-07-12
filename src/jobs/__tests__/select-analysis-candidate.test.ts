import { describe, expect, it } from "vitest";
import {
  isBookEligibleForAnalysis,
  selectNextBookForAnalysis,
  type AnalysisCandidateInput,
  type AnalysisSelectionOptions,
} from "../select-analysis-candidate";

const NOW = new Date("2026-07-12T12:00:00Z");
const DEFAULT_OPTS: AnalysisSelectionOptions = {
  now: NOW,
  cooldownMs: 30 * 60 * 1000,
  maxAttempts: 3,
};

function candidate(
  overrides: Partial<AnalysisCandidateInput> & { bookId: string },
): AnalysisCandidateInput {
  return {
    createdAt: new Date("2026-07-01T00:00:00Z"),
    catalogSource: null,
    visibility: "private",
    pricingTier: "private_premium",
    lastJob: null,
    failedAttempts: 0,
    ...overrides,
  };
}

describe("isBookEligibleForAnalysis", () => {
  it("is eligible when there is no prior job", () => {
    expect(
      isBookEligibleForAnalysis(
        { lastJob: null, failedAttempts: 0 },
        DEFAULT_OPTS,
      ),
    ).toBe(true);
  });

  it("is not eligible while a job is queued", () => {
    expect(
      isBookEligibleForAnalysis(
        { lastJob: { status: "queued", updatedAt: NOW }, failedAttempts: 0 },
        DEFAULT_OPTS,
      ),
    ).toBe(false);
  });

  it("is not eligible while a job is running", () => {
    expect(
      isBookEligibleForAnalysis(
        { lastJob: { status: "running", updatedAt: NOW }, failedAttempts: 0 },
        DEFAULT_OPTS,
      ),
    ).toBe(false);
  });

  it("is not eligible immediately after a failure (still cooling down)", () => {
    const fiveMinAgo = new Date(NOW.getTime() - 5 * 60 * 1000);
    expect(
      isBookEligibleForAnalysis(
        {
          lastJob: { status: "failed", updatedAt: fiveMinAgo },
          failedAttempts: 1,
        },
        DEFAULT_OPTS,
      ),
    ).toBe(false);
  });

  it("is eligible again once the cooldown has elapsed", () => {
    const fortyMinAgo = new Date(NOW.getTime() - 40 * 60 * 1000);
    expect(
      isBookEligibleForAnalysis(
        {
          lastJob: { status: "failed", updatedAt: fortyMinAgo },
          failedAttempts: 1,
        },
        DEFAULT_OPTS,
      ),
    ).toBe(true);
  });

  it("is not eligible once failedAttempts reaches maxAttempts, even past cooldown", () => {
    const oneDayAgo = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(
      isBookEligibleForAnalysis(
        {
          lastJob: { status: "failed", updatedAt: oneDayAgo },
          failedAttempts: 3,
        },
        DEFAULT_OPTS,
      ),
    ).toBe(false);
  });

  it("is eligible immediately when the last job completed (edge case retry)", () => {
    expect(
      isBookEligibleForAnalysis(
        { lastJob: { status: "completed", updatedAt: NOW }, failedAttempts: 0 },
        DEFAULT_OPTS,
      ),
    ).toBe(true);
  });
});

describe("selectNextBookForAnalysis", () => {
  it("returns null when there are no candidates", () => {
    expect(selectNextBookForAnalysis([], DEFAULT_OPTS)).toEqual({
      bookId: null,
      needsManualRetry: [],
    });
  });

  it("prioritizes catalog over published over private", () => {
    const result = selectNextBookForAnalysis(
      [
        candidate({
          bookId: "priv",
          visibility: "private",
          pricingTier: "private_premium",
        }),
        candidate({ bookId: "pub", visibility: "published" }),
        candidate({ bookId: "cat", catalogSource: "gutenberg:1" }),
      ],
      DEFAULT_OPTS,
    );
    expect(result.bookId).toBe("cat");
  });

  it("picks the oldest book within the highest-priority tier", () => {
    const result = selectNextBookForAnalysis(
      [
        candidate({
          bookId: "cat-newer",
          catalogSource: "gutenberg:2",
          createdAt: new Date("2026-07-05T00:00:00Z"),
        }),
        candidate({
          bookId: "cat-older",
          catalogSource: "gutenberg:1",
          createdAt: new Date("2026-07-01T00:00:00Z"),
        }),
      ],
      DEFAULT_OPTS,
    );
    expect(result.bookId).toBe("cat-older");
  });

  it("skips a book with a queued/running job in favor of the next eligible one", () => {
    const result = selectNextBookForAnalysis(
      [
        candidate({
          bookId: "in-flight",
          catalogSource: "gutenberg:1",
          lastJob: { status: "running", updatedAt: NOW },
        }),
        candidate({ bookId: "next-up", visibility: "published" }),
      ],
      DEFAULT_OPTS,
    );
    expect(result.bookId).toBe("next-up");
  });

  it("skips a book still cooling down after a failure", () => {
    const fiveMinAgo = new Date(NOW.getTime() - 5 * 60 * 1000);
    const result = selectNextBookForAnalysis(
      [
        candidate({
          bookId: "cooling",
          catalogSource: "gutenberg:1",
          lastJob: { status: "failed", updatedAt: fiveMinAgo },
          failedAttempts: 1,
        }),
        candidate({ bookId: "fallback", visibility: "private" }),
      ],
      DEFAULT_OPTS,
    );
    expect(result.bookId).toBe("fallback");
  });

  it("retries a book past its cooldown", () => {
    const fortyMinAgo = new Date(NOW.getTime() - 40 * 60 * 1000);
    const result = selectNextBookForAnalysis(
      [
        candidate({
          bookId: "retryable",
          lastJob: { status: "failed", updatedAt: fortyMinAgo },
          failedAttempts: 1,
        }),
      ],
      DEFAULT_OPTS,
    );
    expect(result.bookId).toBe("retryable");
  });

  it("surfaces books over the attempts cap as needsManualRetry and never selects them", () => {
    const oneDayAgo = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const result = selectNextBookForAnalysis(
      [
        candidate({
          bookId: "exhausted",
          lastJob: { status: "failed", updatedAt: oneDayAgo },
          failedAttempts: 3,
        }),
      ],
      DEFAULT_OPTS,
    );
    expect(result.bookId).toBeNull();
    expect(result.needsManualRetry).toEqual(["exhausted"]);
  });

  it("returns null when every candidate is either in flight or cooling down", () => {
    const fiveMinAgo = new Date(NOW.getTime() - 5 * 60 * 1000);
    const result = selectNextBookForAnalysis(
      [
        candidate({
          bookId: "running",
          lastJob: { status: "running", updatedAt: NOW },
        }),
        candidate({
          bookId: "cooling",
          lastJob: { status: "failed", updatedAt: fiveMinAgo },
          failedAttempts: 1,
        }),
      ],
      DEFAULT_OPTS,
    );
    expect(result.bookId).toBeNull();
    expect(result.needsManualRetry).toEqual([]);
  });
});
