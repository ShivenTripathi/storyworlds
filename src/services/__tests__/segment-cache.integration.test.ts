/**
 * Integration test for the content-addressed segment cache
 * (src/services/segment-cache.ts) — the resumability + amortization layer.
 * The key property: the SAME segment text yields the SAME hash, so a second
 * lookup is a hit (no LLM spend), while different text or a bumped prompt
 * version yields a different hash (a miss).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { pushSchema } = await import("drizzle-kit/api");
  const schema = await import("@/db/schema");
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const dbReady = pushSchema(schema, db as never)
    .then(({ apply }) => apply())
    .then(() => db);
  return { db, dbReady, schema };
});

import { dbReady } from "@/db";
import type { SegmentAnalysis } from "@/domain/schemas";
import {
  computeSegmentHash,
  getCachedSegment,
  putCachedSegment,
} from "@/services/segment-cache";

const RESULT: SegmentAnalysis = {
  entities: [
    {
      name: "Ishmael",
      kind: "character",
      aliases: [],
      description: "The narrator.",
      firstSeenPage: 1,
    },
  ],
  events: [{ summary: "A voyage begins.", page: 1 }],
  settingNotes: "A whaling port.",
};

beforeAll(async () => {
  await dbReady;
});

describe("segment cache — amortization + resumability", () => {
  it("misses on unseen text, hits after a write (same text → same hash → no recompute)", async () => {
    const text = "Call me Ishmael. Some years ago—never mind how long...";
    const hash = computeSegmentHash(text);

    expect(await getCachedSegment(hash)).toBeNull();
    await putCachedSegment(hash, RESULT);

    // A retry (or ANY book sharing this exact text) recomputes the same hash
    // and reuses the stored analysis — zero fresh LLM calls.
    expect(computeSegmentHash(text)).toBe(hash);
    expect(await getCachedSegment(hash)).toEqual(RESULT);
  });

  it("different text yields a different hash (no false sharing)", () => {
    expect(computeSegmentHash("chapter one")).not.toBe(
      computeSegmentHash("chapter two"),
    );
  });

  it("double-writing the same hash is idempotent (concurrent duplicate analysis)", async () => {
    const hash = computeSegmentHash("idempotency probe text");
    await putCachedSegment(hash, RESULT);
    await expect(putCachedSegment(hash, RESULT)).resolves.toBeUndefined();
    expect(await getCachedSegment(hash)).toEqual(RESULT);
  });
});
