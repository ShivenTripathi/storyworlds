/**
 * Service-level tests for the Discover/shelf browsing surfaces
 * (src/services/books.ts): the server-side `listPublished` search +
 * pagination behind GET /api/marketplace, and the owned-vs-library "remove
 * from shelf" split behind DELETE /api/books/[bookId].
 *
 * REGRESSION UNDER TEST (audit finding #2): DELETE /api/books/[bookId]
 * previously always called `deleteBook` (a hard delete of the shared book
 * row) behind a write-access check — for a book added from Discover
 * (library-sourced, not owned), that write check 403'd outright, so "Remove
 * from shelf" silently never worked. The fix routes non-owners to
 * `removeFromLibrary` instead, which only detaches THEIR purchases row and
 * must never touch the shared book or any other reader's library entry.
 *
 * Runs against a real in-memory PGlite database (pushed straight from
 * src/db/schema.ts) and an in-memory fake of src/services/storage.ts — same
 * isolation pattern as books-upload.test.ts.
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
    async put() {},
    async get() {
      throw new Error("not found");
    },
    async delete() {},
    async deletePrefix() {},
    async getUrl(key: string) {
      return `/api/files/${key}`;
    },
  },
}));

import { and, eq } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, purchases, users } from "@/db/schema";
import {
  addToLibrary,
  deleteBook,
  getBook,
  listBooks,
  listPublished,
  removeFromLibrary,
} from "@/services/books";

const OWNER = "user_shelf_owner";
const READER = "user_shelf_reader";
const READER_2 = "user_shelf_reader_2";

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    { id: OWNER, email: "owner@example.com" },
    { id: READER, email: "reader@example.com" },
    { id: READER_2, email: "reader2@example.com" },
  ]);
});

async function seedBook(opts: {
  title: string;
  author?: string | null;
  visibility?: "private" | "published";
}) {
  const [book] = await db
    .insert(books)
    .values({
      ownerId: OWNER,
      title: opts.title,
      author: opts.author ?? null,
      status: "ready",
      totalChunks: 10,
      totalWords: 1000,
      visibility: opts.visibility ?? "published",
    })
    .returning();
  return book;
}

// ---------------------------------------------------------------------------
// listPublished — server-side search (?q=) + pagination (?limit=/?offset=)
// ---------------------------------------------------------------------------
describe("listPublished", () => {
  it("only returns published books, never private ones", async () => {
    const pub = await seedBook({ title: "Public Search Target" });
    await seedBook({ title: "Private Search Target", visibility: "private" });

    const { books: found } = await listPublished({ q: "Search Target" });
    expect(found.some((b) => b.id === pub.id)).toBe(true);
    expect(found.every((b) => b.title !== "Private Search Target")).toBe(true);
  });

  it("matches title case-insensitively", async () => {
    const book = await seedBook({ title: "The Windward Lighthouse" });
    const { books: found } = await listPublished({ q: "windward" });
    expect(found.some((b) => b.id === book.id)).toBe(true);
  });

  it("matches author case-insensitively", async () => {
    const book = await seedBook({
      title: "Some Unrelated Title",
      author: "Ada Quill",
    });
    const { books: found } = await listPublished({ q: "ada quill" });
    expect(found.some((b) => b.id === book.id)).toBe(true);
  });

  it("returns nothing for a query that matches no title or author", async () => {
    const { books: found } = await listPublished({
      q: "zzz-no-such-book-exists-zzz",
    });
    expect(found).toHaveLength(0);
  });

  it("paginates with limit/offset, reporting hasMore correctly", async () => {
    // Isolate from other tests' seeded rows with a unique marker.
    const marker = "PaginationMarker";
    for (let i = 0; i < 3; i++) {
      await seedBook({ title: `${marker} ${i}` });
    }

    const page1 = await listPublished({ q: marker, limit: 2, offset: 0 });
    expect(page1.books).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const page2 = await listPublished({ q: marker, limit: 2, offset: 2 });
    expect(page2.books).toHaveLength(1);
    expect(page2.hasMore).toBe(false);

    // No overlap between pages.
    const page1Ids = new Set(page1.books.map((b) => b.id));
    expect(page2.books.every((b) => !page1Ids.has(b.id))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeFromLibrary — the "remove from shelf" fix for library-added books
// ---------------------------------------------------------------------------
describe("removeFromLibrary (DELETE /api/books/[bookId] for non-owners)", () => {
  it("detaches the reader's library entry WITHOUT deleting the shared book", async () => {
    const book = await seedBook({ title: "Shared Catalog Book" });

    await addToLibrary(READER, book.id);
    let shelf = await listBooks(READER);
    expect(
      shelf.some((r) => r.book.id === book.id && r.source === "library"),
    ).toBe(true);

    const removed = await removeFromLibrary(READER, book.id);
    expect(removed).toBe(true);

    // Gone from the reader's shelf...
    shelf = await listBooks(READER);
    expect(shelf.some((r) => r.book.id === book.id)).toBe(false);

    // ...but the book itself is untouched — this is the actual regression:
    // the old code path would have hard-deleted it via `deleteBook`.
    const survivor = await getBook(book.id);
    expect(survivor).toBeDefined();
    expect(survivor?.status).toBe("ready");

    // The owner's copy is unaffected either way.
    const ownerShelf = await listBooks(OWNER);
    expect(
      ownerShelf.some((r) => r.book.id === book.id && r.source === "owned"),
    ).toBe(true);
  });

  it("leaves OTHER readers' library entries for the same book untouched", async () => {
    const book = await seedBook({ title: "Multi-Reader Book" });

    await addToLibrary(READER, book.id);
    await addToLibrary(READER_2, book.id);

    await removeFromLibrary(READER, book.id);

    const shelfReader2 = await listBooks(READER_2);
    expect(shelfReader2.some((r) => r.book.id === book.id)).toBe(true);
    expect(await getBook(book.id)).toBeDefined();
  });

  it("returns false (nothing to detach) when the book isn't in the reader's library", async () => {
    const book = await seedBook({ title: "Never Added Book" });
    const removed = await removeFromLibrary(READER, book.id);
    expect(removed).toBe(false);
    // Book still exists — a no-op, not an accidental delete.
    expect(await getBook(book.id)).toBeDefined();
  });

  it("is idempotent: removing twice returns false the second time", async () => {
    const book = await seedBook({ title: "Remove Twice Book" });
    await addToLibrary(READER, book.id);
    expect(await removeFromLibrary(READER, book.id)).toBe(true);
    expect(await removeFromLibrary(READER, book.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteBook — contrast: the OWNER path is a real hard delete
// ---------------------------------------------------------------------------
describe("deleteBook (owner-only hard delete)", () => {
  it("removes the book for everyone, cascading away other readers' library rows", async () => {
    const book = await seedBook({ title: "Owner-Deleted Book" });
    await addToLibrary(READER, book.id);

    await deleteBook(book.id);

    expect(await getBook(book.id)).toBeUndefined();
    const [purchaseRow] = await db
      .select()
      .from(purchases)
      .where(and(eq(purchases.userId, READER), eq(purchases.bookId, book.id)));
    expect(purchaseRow).toBeUndefined();
  });
});
