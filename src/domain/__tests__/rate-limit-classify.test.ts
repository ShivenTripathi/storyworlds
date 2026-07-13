import { describe, it, expect } from "vitest";
import { classifyRateLimitError, parseRetryAfterMs } from "@/domain/rate-limit";

// The EXACT production error from the July 2026 incident — a DAILY cap
// ("limit: 500 ... free_tier_requests") that carried a short, misleading
// ~46s retry hint. Classifying this as transient burned the rest of the
// day's quota on retries that could never succeed.
const INCIDENT_MESSAGE =
  "You exceeded your current quota, please check your plan and billing details. " +
  "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, " +
  "limit: 500, model: gemini-3.1-flash-lite\nPlease retry in 46.216506914s.";

describe("parseRetryAfterMs", () => {
  it("parses 'retry in Ns'", () => {
    expect(parseRetryAfterMs("Please retry in 46.2s.")).toBe(46200);
  });
  it("parses retryDelay fields", () => {
    expect(parseRetryAfterMs('"retryDelay": "7s"')).toBe(7000);
  });
  it("returns null with no hint", () => {
    expect(parseRetryAfterMs("quota exceeded")).toBeNull();
  });
});

describe("classifyRateLimitError", () => {
  it("classifies the exact incident error as DAILY despite its short retry hint", () => {
    const info = classifyRateLimitError({ message: `429 ${INCIDENT_MESSAGE}` });
    expect(info.kind).toBe("daily");
  });

  it("classifies a short per-minute 429 as transient", () => {
    const info = classifyRateLimitError({
      message: "429 RESOURCE_EXHAUSTED: rate limit. Please retry in 12s.",
    });
    expect(info.kind).toBe("transient");
    expect(info.retryAfterMs).toBe(12000);
  });

  it("classifies a long retry-after as daily even without a metric name", () => {
    expect(
      classifyRateLimitError({
        message: "429 RESOURCE_EXHAUSTED",
        retryAfterMs: 3_600_000,
      }).kind,
    ).toBe("daily");
  });

  it("classifies per-day metric names as daily", () => {
    expect(
      classifyRateLimitError({
        message:
          "429 Quota exceeded: generate_requests_per_model_per_day. Please retry in 30s.",
      }).kind,
    ).toBe("daily");
  });

  it("returns 'none' for non-rate-limit errors", () => {
    expect(classifyRateLimitError({ message: "500 internal" }).kind).toBe(
      "none",
    );
  });
});
