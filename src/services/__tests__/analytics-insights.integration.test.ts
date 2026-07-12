/**
 * Integration test for getStoryInsights (src/services/analytics.ts) against
 * a real in-memory PGlite database. The critical property, same as the
 * Codex's spoiler-safety test: a locked entity (ahead of frontier, or with
 * an unknown introduction point) must never surface as a network node, an
 * edge endpoint, or a screen-time entry — even when its id appears in an
 * overlay the reader has already read. The timeline must fail closed the
 * same way: no entry ahead of the frontier, and no entry whose position is
 * unknown, ever leaks its label/summary — only a count is safe to reveal.
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

import { db, dbReady } from "@/db";
import {
  books,
  entities,
  overlays,
  readingProgress,
  users,
  worldReferences,
} from "@/db/schema";
import { getStoryInsights } from "@/services/analytics";

const READER = "user_insights_reader";
let BOOK_ID = "";

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values({ id: READER, email: "i@example.com" });
  const [book] = await db
    .insert(books)
    .values({
      ownerId: READER,
      title: "Insights Test",
      status: "ready",
      totalChunks: 100,
    })
    .returning();
  BOOK_ID = book.id;

  await db.insert(entities).values([
    {
      bookId: BOOK_ID,
      id: "char:met",
      name: "Met Hero",
      kind: "character",
      introducedAtChunk: 0,
      attributes: {},
    },
    {
      bookId: BOOK_ID,
      id: "loc:place",
      name: "The Keep",
      kind: "location",
      introducedAtChunk: 2,
      attributes: {},
    },
    {
      bookId: BOOK_ID,
      id: "char:ahead",
      name: "Ahead Villain",
      kind: "character",
      introducedAtChunk: 500, // ahead of the frontier below -> locked
      attributes: {},
    },
    {
      bookId: BOOK_ID,
      id: "char:ghost",
      name: "Ghost",
      kind: "character",
      introducedAtChunk: null, // unknown introduction -> locked (fail closed)
      attributes: {},
    },
  ]);

  await db.insert(overlays).values([
    {
      bookId: BOOK_ID,
      chunkIdx: 0,
      status: "ready",
      // char:ghost co-occurs with met/place on an ALREADY-READ page — must
      // still be excluded from every node/edge (its own intro is unknown).
      activeEntityIds: ["char:met", "loc:place", "char:ghost"],
      imageId: null,
    },
    {
      bookId: BOOK_ID,
      chunkIdx: 3,
      status: "ready",
      activeEntityIds: ["char:met"],
      imageId: null,
    },
    // Ahead of the reader's frontier (10) — must not contribute anything.
    {
      bookId: BOOK_ID,
      chunkIdx: 90,
      status: "ready",
      activeEntityIds: ["char:ahead"],
      imageId: null,
    },
  ]);

  await db.insert(worldReferences).values({
    bookId: BOOK_ID,
    status: "completed",
    settingDescription: "A test world.",
    timeline: [
      { label: "Opening", summary: "Safe, early beat.", approxPage: 1 },
      // Ahead of the frontier (page 95 -> chunk 94 > frontier 10).
      { label: "Late Reveal", summary: "A late-book spoiler.", approxPage: 95 },
      // Unknown position -> fails closed even though it might be early.
      { label: "Unplaced", summary: "Position unknown." },
    ],
  });

  await db.insert(readingProgress).values({
    userId: READER,
    bookId: BOOK_ID,
    currentChunk: 10,
    frontierChunk: 10,
  });
});

describe("getStoryInsights spoiler safety", () => {
  it("excludes locked entities from the network entirely, even when co-occurring on a read page", async () => {
    const insights = await getStoryInsights({
      userId: READER,
      bookId: BOOK_ID,
    });

    const nodeIds = insights.network.nodes.map((n) => n.id);
    expect(nodeIds.sort()).toEqual(["char:met", "loc:place"]);

    for (const edge of insights.network.edges) {
      expect(edge.source).not.toBe("char:ghost");
      expect(edge.target).not.toBe("char:ghost");
      expect(edge.source).not.toBe("char:ahead");
      expect(edge.target).not.toBe("char:ahead");
    }

    // No leak anywhere in the payload — not even in a stray string field.
    const serialized = JSON.stringify(insights.network);
    expect(serialized).not.toContain("Ghost");
    expect(serialized).not.toContain("Villain");
    expect(serialized).not.toContain("char:ghost");
    expect(serialized).not.toContain("char:ahead");
  });

  it("computes screen-time and co-occurrence only from revealed entities", async () => {
    const insights = await getStoryInsights({
      userId: READER,
      bookId: BOOK_ID,
    });

    const met = insights.screenTime.find((n) => n.id === "char:met");
    const place = insights.screenTime.find((n) => n.id === "loc:place");
    expect(met?.pageCount).toBe(2); // chunkIdx 0 and 3
    expect(place?.pageCount).toBe(1); // chunkIdx 0 only

    expect(insights.network.edges).toHaveLength(1);
    const [edge] = insights.network.edges;
    expect([edge.source, edge.target].sort()).toEqual([
      "char:met",
      "loc:place",
    ]);
    expect(edge.weight).toBe(1);
  });

  it("filters the timeline to the frontier and fails closed on an unplaced entry", async () => {
    const insights = await getStoryInsights({
      userId: READER,
      bookId: BOOK_ID,
    });

    expect(insights.timeline.entries).toHaveLength(1);
    expect(insights.timeline.entries[0].label).toBe("Opening");
    expect(insights.timeline.totalCount).toBe(3);
    expect(insights.timeline.hiddenAheadCount).toBe(2);

    const serialized = JSON.stringify(insights.timeline.entries);
    expect(serialized).not.toContain("Late Reveal");
    expect(serialized).not.toContain("spoiler");
    expect(serialized).not.toContain("Unplaced");
  });

  it("owner/admin full view reveals every entity, edge, and timeline entry", async () => {
    const insights = await getStoryInsights({
      userId: READER,
      bookId: BOOK_ID,
      isOwnerOrAdmin: true,
    });

    const nodeIds = insights.network.nodes.map((n) => n.id).sort();
    expect(nodeIds).toEqual([
      "char:ahead",
      "char:ghost",
      "char:met",
      "loc:place",
    ]);
    expect(insights.timeline.entries).toHaveLength(3);
    expect(insights.timeline.hiddenAheadCount).toBe(0);
    expect(insights.timeline.frontierChunk).toBeNull();
  });
});
