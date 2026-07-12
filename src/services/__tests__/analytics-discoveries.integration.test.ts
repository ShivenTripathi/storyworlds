/**
 * Integration test for the "Discoveries" (Codex) three-state contract added
 * to getCodexForBook (src/services/analytics.ts): a revealed card now
 * carries an explicit `illustrationPending` boolean rather than the UI
 * inferring "art not here yet" from `portraitUrl === null`. This must be
 * true for every revealed card that has no portrait, and false the moment
 * one exists — locked cards are untouched (covered by
 * analytics-codex.integration.test.ts).
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
import { getCodexForBook, type CodexCardRevealed } from "@/services/analytics";

const READER = "user_discoveries_reader";
let BOOK_ID = "";

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values({ id: READER, email: "d@example.com" });
  const [book] = await db
    .insert(books)
    .values({
      ownerId: READER,
      title: "Discoveries Test",
      status: "ready",
      totalChunks: 100,
    })
    .returning();
  BOOK_ID = book.id;

  await db.insert(entities).values([
    {
      bookId: BOOK_ID,
      id: "char:illustrated",
      name: "Illustrated Hero",
      kind: "character",
      introducedAtChunk: 0,
      attributes: {},
    },
    {
      bookId: BOOK_ID,
      id: "char:pending",
      name: "Pending Hero",
      kind: "character",
      introducedAtChunk: 0,
      attributes: {},
    },
  ]);

  const [img] = await db
    .insert(images)
    .values({ bookId: BOOK_ID, storageKey: "books/x/scene.png" })
    .returning();

  await db.insert(overlays).values([
    // char:illustrated appears on a page with a ready illustration.
    {
      bookId: BOOK_ID,
      chunkIdx: 0,
      status: "ready",
      activeEntityIds: ["char:illustrated"],
      imageId: img.id,
    },
    // char:pending appears, but the overlay has no image yet.
    {
      bookId: BOOK_ID,
      chunkIdx: 1,
      status: "ready",
      activeEntityIds: ["char:pending"],
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

function isRevealed(
  card: Awaited<ReturnType<typeof getCodexForBook>>["cards"][number],
): card is CodexCardRevealed {
  return card.state !== "locked";
}

describe("getCodexForBook illustrationPending (three visual states)", () => {
  it("is false once a portrait exists", async () => {
    const { cards } = await getCodexForBook({
      userId: READER,
      bookId: BOOK_ID,
    });
    const card = cards
      .filter(isRevealed)
      .find((c) => c.id === "char:illustrated");
    expect(card).toBeDefined();
    expect(card?.portraitUrl).toBe("/api/files/books/x/scene.png");
    expect(card?.illustrationPending).toBe(false);
  });

  it("is true — and name/rarity still visible — when met but no portrait yet", async () => {
    const { cards } = await getCodexForBook({
      userId: READER,
      bookId: BOOK_ID,
    });
    const card = cards.filter(isRevealed).find((c) => c.id === "char:pending");
    expect(card).toBeDefined();
    expect(card?.portraitUrl).toBeNull();
    expect(card?.illustrationPending).toBe(true);
    // Even while the illustration is pending, name/rarity are already safe
    // to show — this is NOT the locked/silhouette state.
    expect(card?.name).toBe("Pending Hero");
    expect(card?.rarity).toBeTruthy();
  });
});
