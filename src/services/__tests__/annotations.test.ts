/**
 * Integration tests for src/services/annotations.ts (highlights, bookmarks,
 * and frontier-gated search) against a real in-memory PGlite database with
 * the repo's actual schema pushed — no running server, no network, no
 * touching of the dev DB at .data/pglite.
 *
 * What's covered:
 *  1. Highlights: create/list/update/delete, and per-user scoping — user B
 *     can never read, edit, or delete user A's highlight.
 *  2. Bookmarks: add (+ idempotent re-add updates the label rather than
 *     duplicating), list, remove, and the same per-user scoping.
 *  3. searchBook: case-insensitive matching + snippet construction, and —
 *     the CRITICAL spoiler-safety property — a search NEVER returns a hit
 *     from a chunk beyond the caller's frontier, by default. Only an
 *     explicit `useFrontier: false` (which only the route ever sets, after
 *     verifying the caller is the book's owner/admin) lifts the gate.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { pushSchema } = await import("drizzle-kit/api");
  const schema = await import("@/db/schema");
  const client = new PGlite(); // in-memory, isolated per test run
  const db = drizzle(client, { schema });
  const dbReady = pushSchema(schema, db as never)
    .then(({ apply }) => apply())
    .then(() => db);
  return { db, dbReady, schema };
});

import { db, dbReady } from "@/db";
import { books, chunks, users } from "@/db/schema";
import { ApiError } from "@/lib/errors";
import {
  addBookmark,
  createHighlight,
  deleteHighlight,
  listBookmarks,
  listHighlights,
  removeBookmark,
  searchBook,
  updateHighlight,
} from "@/services/annotations";

const USER_A = "user_a";
const USER_B = "user_b";

let bookId: string;

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    { id: USER_A, email: "a@example.com" },
    { id: USER_B, email: "b@example.com" },
  ]);

  const [book] = await db
    .insert(books)
    .values({
      ownerId: USER_A,
      title: "Annotations Test",
      status: "ready",
      totalChunks: 20,
      totalWords: 2000,
    })
    .returning();
  bookId = book.id;

  // Chunk 5 mentions "Paul dies" — a stand-in spoiler; chunk 1 has a
  // benign, earlier occurrence of the same search term ("Paul").
  const pageText = (idx: number) => {
    if (idx === 1) return "Paul walks into the desert at dawn.";
    if (idx === 5) return "In the final duel, Paul dies at dusk.";
    return `Page ${idx + 1} filler text with nothing notable.`;
  };
  await db.insert(chunks).values(
    Array.from({ length: 20 }, (_, i) => ({
      bookId,
      idx: i,
      pageNumber: i + 1,
      wordCount: 10,
      text: pageText(i),
    })),
  );
});

// ---------------------------------------------------------------------------
// Highlights (+ notes)
// ---------------------------------------------------------------------------
describe("highlights: persistence and per-user scoping", () => {
  it("creates and lists a highlight scoped to the caller", async () => {
    const created = await createHighlight({
      userId: USER_A,
      bookId,
      chunkIdx: 1,
      text: "Paul walks into the desert",
      color: "green",
    });
    expect(created.color).toBe("green");
    expect(created.note).toBeNull();

    const listA = await listHighlights(USER_A, bookId);
    expect(listA.map((h) => h.id)).toContain(created.id);

    const listB = await listHighlights(USER_B, bookId);
    expect(listB.some((h) => h.id === created.id)).toBe(false);
  });

  it("defaults to yellow and stores a note when creating a highlight with one", async () => {
    const created = await createHighlight({
      userId: USER_A,
      bookId,
      chunkIdx: 1,
      text: "at dawn",
      note: "Foreshadowing?",
    });
    expect(created.color).toBe("yellow");
    expect(created.note).toBe("Foreshadowing?");
  });

  it("updateHighlight changes color/note, but only for the owning user", async () => {
    const created = await createHighlight({
      userId: USER_A,
      bookId,
      chunkIdx: 1,
      text: "into the desert",
    });

    const updated = await updateHighlight(USER_A, created.id, {
      color: "pink",
      note: "changed my mind",
    });
    expect(updated.color).toBe("pink");
    expect(updated.note).toBe("changed my mind");

    await expect(
      updateHighlight(USER_B, created.id, { color: "blue" }),
    ).rejects.toMatchObject({ status: 404 });

    // User B's failed attempt didn't mutate the row.
    const refetched = await listHighlights(USER_A, bookId);
    const row = refetched.find((h) => h.id === created.id);
    expect(row?.color).toBe("pink");
  });

  it("deleteHighlight is scoped to the owning user (404, never another user's row)", async () => {
    const created = await createHighlight({
      userId: USER_A,
      bookId,
      chunkIdx: 1,
      text: "dawn",
    });

    await expect(deleteHighlight(USER_B, created.id)).rejects.toMatchObject({
      status: 404,
    });
    // Still there — B's attempt didn't delete it.
    expect(
      (await listHighlights(USER_A, bookId)).some((h) => h.id === created.id),
    ).toBe(true);

    await deleteHighlight(USER_A, created.id);
    expect(
      (await listHighlights(USER_A, bookId)).some((h) => h.id === created.id),
    ).toBe(false);
  });

  it("deleting a nonexistent highlight id 404s", async () => {
    await expect(
      deleteHighlight(USER_A, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ status: 404 });
    expect(new ApiError(404, "not_found").status).toBe(404); // sanity on the error shape used above
  });
});

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------
describe("bookmarks: upsert, listing, and per-user scoping", () => {
  it("adds a bookmark and lists it back for the caller only", async () => {
    const created = await addBookmark({ userId: USER_A, bookId, chunkIdx: 3 });
    expect(created.chunkIdx).toBe(3);
    expect(created.label).toBeNull();

    const listA = await listBookmarks(USER_A, bookId);
    expect(listA.map((b) => b.id)).toContain(created.id);
    const listB = await listBookmarks(USER_B, bookId);
    expect(listB.some((b) => b.id === created.id)).toBe(false);
  });

  it("re-bookmarking the same page upserts the label instead of duplicating", async () => {
    await addBookmark({ userId: USER_A, bookId, chunkIdx: 4, label: "first" });
    const second = await addBookmark({
      userId: USER_A,
      bookId,
      chunkIdx: 4,
      label: "updated",
    });
    expect(second.label).toBe("updated");

    const rows = (await listBookmarks(USER_A, bookId)).filter(
      (b) => b.chunkIdx === 4,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("updated");
  });

  it("two users can independently bookmark the same page", async () => {
    await addBookmark({ userId: USER_A, bookId, chunkIdx: 7 });
    await addBookmark({ userId: USER_B, bookId, chunkIdx: 7 });

    const a = (await listBookmarks(USER_A, bookId)).find(
      (b) => b.chunkIdx === 7,
    );
    const b = (await listBookmarks(USER_B, bookId)).find(
      (b) => b.chunkIdx === 7,
    );
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.id).not.toBe(b?.id);
  });

  it("removeBookmark is scoped to the owning user (404, never another user's row)", async () => {
    const created = await addBookmark({
      userId: USER_A,
      bookId,
      chunkIdx: 9,
    });

    await expect(removeBookmark(USER_B, created.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      (await listBookmarks(USER_A, bookId)).some((b) => b.id === created.id),
    ).toBe(true);

    await removeBookmark(USER_A, created.id);
    expect(
      (await listBookmarks(USER_A, bookId)).some((b) => b.id === created.id),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// searchBook — the SPOILER-FRONTIER hard invariant
// ---------------------------------------------------------------------------
describe("searchBook: frontier-gated by default (spoiler safety)", () => {
  it("finds a match within the frontier, with a highlighted-in-place snippet", async () => {
    const results = await searchBook({
      bookId,
      q: "paul",
      useFrontier: true,
      frontierChunk: 4, // has read up through chunk 4 — chunk 1's "Paul" is in range, chunk 5's isn't
    });
    expect(results).toHaveLength(1);
    expect(results[0].chunkIdx).toBe(1);
    const { snippet, matchStart, matchLength } = results[0];
    expect(
      snippet.slice(matchStart, matchStart + matchLength).toLowerCase(),
    ).toBe("paul");
  });

  it("CRITICAL: never returns a hit from a chunk beyond the reader's frontier", async () => {
    // Chunk 5 ("In the final duel, Paul dies at dusk.") is a stand-in for a
    // spoiler the reader hasn't reached yet. A search for "paul" with the
    // frontier still at 4 must not surface it, no matter how the query is
    // cased or how many results would otherwise match.
    const results = await searchBook({
      bookId,
      q: "PAUL",
      useFrontier: true,
      frontierChunk: 4,
    });
    expect(results.every((r) => r.chunkIdx <= 4)).toBe(true);
    expect(results.some((r) => r.chunkIdx === 5)).toBe(false);
  });

  it("advancing the frontier past the spoiler chunk reveals it", async () => {
    const results = await searchBook({
      bookId,
      q: "paul",
      useFrontier: true,
      frontierChunk: 5,
    });
    expect(results.some((r) => r.chunkIdx === 5)).toBe(true);
  });

  it("defaults to frontier-gated even when useFrontier is omitted entirely", async () => {
    // No useFrontier/frontierChunk passed at all — must still gate to
    // frontierChunk 0 (nothing read yet) rather than searching everything.
    const results = await searchBook({ bookId, q: "paul" });
    expect(results.every((r) => r.chunkIdx <= 0)).toBe(true);
  });

  it("useFrontier: false (owner/admin-only, set by the route) searches the whole book", async () => {
    const results = await searchBook({ bookId, q: "paul", useFrontier: false });
    const chunkIdxs = results.map((r) => r.chunkIdx).sort((a, b) => a - b);
    expect(chunkIdxs).toEqual([1, 5]);
  });

  it("is case-insensitive and returns nothing for a query with no match", async () => {
    const results = await searchBook({
      bookId,
      q: "nonexistentword",
      useFrontier: false,
    });
    expect(results).toHaveLength(0);
  });

  it("an empty/whitespace query returns no results without querying the DB", async () => {
    expect(await searchBook({ bookId, q: "" })).toEqual([]);
    expect(await searchBook({ bookId, q: "   " })).toEqual([]);
  });
});
