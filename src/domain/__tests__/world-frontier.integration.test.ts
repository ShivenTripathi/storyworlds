/**
 * Regression tests for the SPOILER FRONTIER gate in getWorldForReader
 * (src/services/world.ts) — the hard invariant that a reader never sees world
 * content from past their furthest-read point. Runs against a real in-memory
 * PGlite database pushed from src/db/schema.ts (same harness as
 * persistence-privacy.integration.test.ts).
 *
 * These lock two fail-OPEN bugs that leaked the whole book to a page-1 reader:
 *  - the timeline was filtered on a non-existent `chunk` field while the data
 *    carries `approxPage`, so every entry always showed;
 *  - an entity whose introduction point was unknown (introducedAtChunk null)
 *    was shown to everyone.
 * Both now fail CLOSED.
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

vi.mock("@/jobs/client", () => ({ inngest: { send: vi.fn() } }));

import { db, dbReady } from "@/db";
import {
  books,
  entities,
  readingProgress,
  users,
  worldReferences,
} from "@/db/schema";
import { getWorldForReader } from "@/services/world";

const READER = "user_frontier_reader";
let BOOK_ID = "";

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values({ id: READER, email: "r@example.com" });
  const [book] = await db
    .insert(books)
    .values({ ownerId: READER, title: "Spoiler Test", status: "ready" })
    .returning();
  BOOK_ID = book.id;

  await db.insert(worldReferences).values({
    bookId: BOOK_ID,
    status: "completed",
    // Whole-book timeline: an early beat (page 2 → chunk 1), a late beat
    // (page 100), and one the pipeline couldn't place (no approxPage).
    timeline: [
      { label: "Opening", summary: "It begins.", approxPage: 2 },
      { label: "Climax", summary: "The twist.", approxPage: 100 },
      { label: "Unplaced", summary: "Somewhere." },
    ],
  });

  await db.insert(entities).values([
    {
      bookId: BOOK_ID,
      id: "char:met",
      name: "Met",
      kind: "character",
      introducedAtChunk: 0,
      attributes: {},
    },
    {
      bookId: BOOK_ID,
      id: "char:ahead",
      name: "Ahead",
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
  ]);

  // Reader is 10 chunks in.
  await db.insert(readingProgress).values({
    userId: READER,
    bookId: BOOK_ID,
    currentChunk: 10,
    frontierChunk: 10,
  });
});

describe("getWorldForReader spoiler frontier", () => {
  it("hides entities introduced ahead of the frontier AND entities with an unknown intro (fail closed)", async () => {
    const world = await getWorldForReader({
      bookId: BOOK_ID,
      userId: READER,
      useFrontier: true,
    });
    const ids = (world.entities ?? []).map((e) => e.id);
    expect(ids).toContain("char:met");
    expect(ids).not.toContain("char:ahead"); // ahead of frontier
    expect(ids).not.toContain("char:ghost"); // unknown intro → fail closed
  });

  it("hides timeline entries past the frontier AND entries with no page (fail closed)", async () => {
    const world = await getWorldForReader({
      bookId: BOOK_ID,
      userId: READER,
      useFrontier: true,
    });
    const labels = (world.timeline as { label: string }[]).map((t) => t.label);
    expect(labels).toEqual(["Opening"]); // page 2 → chunk 1 ≤ 10; others hidden
  });

  it("owner/admin full view (useFrontier:false) sees everything", async () => {
    const world = await getWorldForReader({
      bookId: BOOK_ID,
      userId: READER,
      useFrontier: false,
    });
    expect((world.entities ?? []).length).toBe(3);
    expect((world.timeline ?? []).length).toBe(3);
  });
});
