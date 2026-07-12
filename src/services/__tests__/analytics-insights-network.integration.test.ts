/**
 * Integration test for the portrait/character-web + page-linked-timeline
 * additions to getStoryInsights (src/services/analytics.ts): network nodes
 * now carry a `portraitUrl` (batched from the same overlay scan, same
 * pattern as getCodexForBook) and a small `keyEvents` list tying the node to
 * the story's key moments; timeline entries carry `entityIds` so a "featuring"
 * chip/tooltip can be built without a second spoiler-risk lookup. All of it
 * must stay frontier-safe: a locked entity must never appear in a node's
 * portrait/keyEvents, nor in another event's entityIds, nor gain a page link
 * it hasn't earned.
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

vi.mock("@/services/storage", () => ({
  storage: {
    async getUrl(key: string) {
      return `/api/files/${key}`;
    },
  },
}));

import { db, dbReady } from "@/db";
import {
  books,
  entities,
  images,
  overlays,
  readingProgress,
  users,
  worldReferences,
} from "@/db/schema";
import { getStoryInsights } from "@/services/analytics";

const READER = "user_insights_network_reader";
let BOOK_ID = "";

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values({ id: READER, email: "n@example.com" });
  const [book] = await db
    .insert(books)
    .values({
      ownerId: READER,
      title: "Network Test",
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
      introducedAtChunk: 500, // ahead of frontier -> locked
      attributes: {},
    },
  ]);

  const [img] = await db
    .insert(images)
    .values({ bookId: BOOK_ID, storageKey: "books/n/scene.png" })
    .returning();

  await db.insert(overlays).values([
    {
      bookId: BOOK_ID,
      chunkIdx: 0,
      status: "ready",
      activeEntityIds: ["char:met", "loc:place"],
      imageId: img.id,
    },
    // The event below lands on this page — char:ahead must never appear in
    // its entityIds even though this chunk is at/behind the frontier and
    // char:ahead has (hypothetically) co-occurred on an ahead chunk only.
    {
      bookId: BOOK_ID,
      chunkIdx: 3,
      status: "ready",
      activeEntityIds: ["char:met"],
      imageId: null,
    },
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
      // page 1 -> chunk 0, where char:met + loc:place co-occur.
      { label: "Opening", summary: "Safe, early beat.", approxPage: 1 },
      // page 4 -> chunk 3, only char:met is active.
      { label: "Second beat", summary: "Later but still safe.", approxPage: 4 },
      // Ahead of the frontier (10) -> excluded from entries entirely.
      { label: "Late Reveal", summary: "A late-book spoiler.", approxPage: 95 },
    ],
  });

  await db.insert(readingProgress).values({
    userId: READER,
    bookId: BOOK_ID,
    currentChunk: 10,
    frontierChunk: 10,
  });
});

describe("getStoryInsights — portrait network + page-linked timeline", () => {
  it("attaches a portraitUrl to the node with an illustrated scene, and null to the one without", async () => {
    const insights = await getStoryInsights({
      userId: READER,
      bookId: BOOK_ID,
    });
    const met = insights.network.nodes.find((n) => n.id === "char:met");
    const place = insights.network.nodes.find((n) => n.id === "loc:place");
    expect(met?.portraitUrl).toBe("/api/files/books/n/scene.png");
    expect(place?.portraitUrl).toBe("/api/files/books/n/scene.png");
  });

  it("ties revealed nodes to the frontier-safe events they're involved in", async () => {
    const insights = await getStoryInsights({
      userId: READER,
      bookId: BOOK_ID,
    });
    const met = insights.network.nodes.find((n) => n.id === "char:met");
    const place = insights.network.nodes.find((n) => n.id === "loc:place");
    expect(met?.keyEvents).toEqual(
      expect.arrayContaining(["Opening", "Second beat"]),
    );
    expect(place?.keyEvents).toEqual(["Opening"]);
    // Never a hint of the ahead-of-frontier event or entity.
    expect(JSON.stringify(insights.network.nodes)).not.toContain("Late Reveal");
  });

  it("annotates each timeline entry with its (frontier-safe) cast, never a locked id", async () => {
    const insights = await getStoryInsights({
      userId: READER,
      bookId: BOOK_ID,
    });
    const opening = insights.timeline.entries.find(
      (e) => e.label === "Opening",
    );
    const second = insights.timeline.entries.find(
      (e) => e.label === "Second beat",
    );
    expect(opening?.entityIds.sort()).toEqual(["char:met", "loc:place"]);
    expect(second?.entityIds).toEqual(["char:met"]);
    for (const entry of insights.timeline.entries) {
      expect(entry.entityIds).not.toContain("char:ahead");
    }
  });

  it("edge weight reflects shared-scene count, ready for a 'share N scenes' affordance", async () => {
    const insights = await getStoryInsights({
      userId: READER,
      bookId: BOOK_ID,
    });
    const edge = insights.network.edges.find(
      (e) => [e.source, e.target].sort().join(",") === "char:met,loc:place",
    );
    expect(edge?.weight).toBe(1);
  });
});
