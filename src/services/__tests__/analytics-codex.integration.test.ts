/**
 * Integration test for getCodexForBook (src/services/analytics.ts) against a
 * real in-memory PGlite database. The critical property: a LOCKED card leaks
 * NOTHING that identifies the entity (no id, name, rarity, or portrait) — the
 * codex is spoiler-safe by construction, gated by the same fail-closed
 * frontier rule as the world DTO.
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
} from "@/db/schema";
import { getCodexForBook } from "@/services/analytics";

const READER = "user_codex_reader";
let BOOK_ID = "";

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values({ id: READER, email: "c@example.com" });
  const [book] = await db
    .insert(books)
    .values({
      ownerId: READER,
      title: "Codex Test",
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
      id: "char:ahead",
      name: "Ahead Villain",
      kind: "character",
      introducedAtChunk: 500,
      attributes: {},
    },
    {
      bookId: BOOK_ID,
      id: "char:ghost",
      name: "Ghost",
      kind: "character",
      introducedAtChunk: null,
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
  ]);

  const [img] = await db
    .insert(images)
    .values({ bookId: BOOK_ID, storageKey: "books/x/scene.png" })
    .returning();

  await db.insert(overlays).values([
    {
      bookId: BOOK_ID,
      chunkIdx: 0,
      status: "ready",
      activeEntityIds: ["char:met", "loc:place"],
      imageId: img.id,
    },
    {
      bookId: BOOK_ID,
      chunkIdx: 3,
      status: "ready",
      activeEntityIds: ["char:met"],
      imageId: null,
    },
    // An overlay AHEAD of the frontier — must not contribute to any stat.
    {
      bookId: BOOK_ID,
      chunkIdx: 90,
      status: "ready",
      activeEntityIds: ["char:ahead"],
      imageId: null,
    },
  ]);

  await db.insert(readingProgress).values({
    userId: READER,
    bookId: BOOK_ID,
    currentChunk: 10,
    frontierChunk: 10,
  });
});

describe("getCodexForBook spoiler safety", () => {
  it("locked cards leak NOTHING beyond kind + grid slot", async () => {
    const { cards } = await getCodexForBook({
      userId: READER,
      bookId: BOOK_ID,
    });
    const locked = cards.filter((c) => c.state === "locked");
    // char:ahead (ahead of frontier) + char:ghost (null intro) both locked.
    expect(locked).toHaveLength(2);
    for (const card of locked) {
      expect(Object.keys(card).sort()).toEqual(["kind", "slot", "state"]);
      expect(JSON.stringify(card)).not.toContain("Villain");
      expect(JSON.stringify(card)).not.toContain("Ghost");
      expect(JSON.stringify(card)).not.toContain("char:");
    }
  });

  it("revealed cards carry name + rarity + portrait, and counts are frontier-gated", async () => {
    const { cards, counts } = await getCodexForBook({
      userId: READER,
      bookId: BOOK_ID,
    });
    const revealed = cards.filter((c) => c.state !== "locked");
    const ids = revealed.map((c) => c.id);
    expect(ids).toContain("char:met");
    expect(ids).toContain("loc:place");

    const hero = revealed.find((c) => c.id === "char:met");
    expect(hero?.rarity).toBeTruthy();
    expect(hero?.portraitUrl).toBe("/api/files/books/x/scene.png");

    expect(counts.character).toEqual({ met: 1, total: 3 });
    expect(counts.location).toEqual({ met: 1, total: 1 });
  });

  it("owner/admin view reveals every card", async () => {
    const { cards } = await getCodexForBook({
      userId: READER,
      bookId: BOOK_ID,
      isOwnerOrAdmin: true,
    });
    expect(cards.every((c) => c.state !== "locked")).toBe(true);
    expect(cards).toHaveLength(4);
  });
});
