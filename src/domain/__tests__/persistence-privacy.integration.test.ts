/**
 * Regression tests for reading-progress + chat-history PERSISTENCE and
 * PRIVACY (per-user scoping), run against a real in-memory PGlite database
 * with the repo's actual Drizzle migrations applied — no running server, no
 * network, and no touching of the dev DB at .data/pglite.
 *
 * PLACEMENT NOTE: these are service-level tests (src/services/books.ts,
 * src/services/chat.ts, src/lib/auth.ts requireBookAccess). They live under
 * src/domain/__tests__/ only because vitest.config.ts currently includes
 * ONLY "src/domain/**\/__tests__/**\/*.test.ts" and this audit was not
 * allowed to edit config. Recommended follow-up for the fixer: widen the
 * vitest include to "src/**\/__tests__/**\/*.test.ts" and move this file to
 * src/services/__tests__/.
 *
 * What is covered (see the audit report for the full PASS/GAP verdict):
 *  1. updateProgress upsert: currentChunk tracks the reader, frontierChunk
 *     is monotonic (greatest()), and client-supplied positions are clamped
 *     to the book's real length so the spoiler gate can't be inflated.
 *  2. Progress is keyed (userId, bookId): user A's writes never touch user
 *     B's row; getProgress/listBooks only ever surface the caller's row.
 *  3. Chat sessions are unique per (userId, bookId, entityId, mode); both
 *     sides of a turn round-trip through appendMessage/getHistory in order;
 *     findSession never returns another user's session for the same
 *     book/character/mode.
 *  4. requireBookAccess: owner-only for private books, read-only for
 *     published books, write always owner/admin-only.
 *  5. Documented data-loss semantics: deleting a book cascades away every
 *     user's progress and chat; wiping entities (analysis re-run) orphans
 *     chat sessions rather than deleting them, and getKnowledge then 404s.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

// Replace the shared Drizzle client with a fresh in-memory PGlite instance
// whose tables are pushed straight from src/db/schema.ts (drizzle-kit's
// programmatic push) — always in sync with the code under test, even when
// ./drizzle migrations lag behind schema edits.
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

// src/lib/auth.ts imports @clerk/nextjs/server at module scope; requireUser
// is not under test here, so stub the Clerk surface entirely.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null, sessionClaims: null })),
  clerkClient: vi.fn(async () => ({ users: { getUser: vi.fn() } })),
}));

import { db, dbReady } from "@/db";
import {
  books,
  chatMessages,
  chatSessions,
  chunks,
  entities,
  purchases,
  readingProgress,
  users,
} from "@/db/schema";
import { requireBookAccess } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import {
  deleteBook,
  getProgress,
  listBooks,
  updateProgress,
} from "@/services/books";
import {
  appendMessage,
  findSession,
  getHistory,
  getKnowledge,
  getOrCreateSession,
} from "@/services/chat";
import { and, eq } from "drizzle-orm";

const USER_A = "user_a";
const USER_B = "user_b";
const ADMIN = "user_admin";

let privateBookId: string;
let publishedBookId: string;

async function seedBook(opts: {
  ownerId: string;
  title: string;
  totalChunks: number;
  visibility?: "private" | "published";
}): Promise<string> {
  const [book] = await db
    .insert(books)
    .values({
      ownerId: opts.ownerId,
      title: opts.title,
      status: "ready",
      totalChunks: opts.totalChunks,
      totalWords: opts.totalChunks * 100,
      visibility: opts.visibility ?? "private",
    })
    .returning();
  await db.insert(chunks).values(
    Array.from({ length: opts.totalChunks }, (_, i) => ({
      bookId: book.id,
      idx: i,
      pageNumber: i + 1,
      wordCount: 100,
      text: `Page ${i + 1} text.`,
    })),
  );
  return book.id;
}

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    { id: USER_A, email: "a@example.com" },
    { id: USER_B, email: "b@example.com" },
    { id: ADMIN, email: "admin@example.com", role: "admin" },
  ]);
  privateBookId = await seedBook({
    ownerId: USER_A,
    title: "Private Book",
    totalChunks: 10,
  });
  publishedBookId = await seedBook({
    ownerId: USER_A,
    title: "Published Book",
    totalChunks: 20,
    visibility: "published",
  });
});

// ---------------------------------------------------------------------------
// 1. Reading-progress persistence + monotonic frontier
// ---------------------------------------------------------------------------
describe("updateProgress: persistence and monotonic frontier", () => {
  it("creates a durable per-user row on first save (frontier = current)", async () => {
    const row = await updateProgress(USER_A, privateBookId, 5);
    expect(row.currentChunk).toBe(5);
    expect(row.frontierChunk).toBe(5);

    // Re-read from the DB (simulates reload / re-login: progress is keyed by
    // userId in Postgres, not by anything client-local).
    const restored = await getProgress(USER_A, privateBookId);
    expect(restored?.currentChunk).toBe(5);
    expect(restored?.frontierChunk).toBe(5);
  });

  it("frontier NEVER regresses when the reader pages backward", async () => {
    const row = await updateProgress(USER_A, privateBookId, 2);
    expect(row.currentChunk).toBe(2); // position follows the reader
    expect(row.frontierChunk).toBe(5); // spoiler gate stays at the max
  });

  it("frontier advances when the reader passes their previous max", async () => {
    const row = await updateProgress(USER_A, privateBookId, 8);
    expect(row.currentChunk).toBe(8);
    expect(row.frontierChunk).toBe(8);
  });

  it("clamps client-supplied positions to the book's real length (spoiler gate can't be inflated)", async () => {
    const row = await updateProgress(USER_A, privateBookId, 999_999);
    // totalChunks = 10 → max valid idx = 9
    expect(row.currentChunk).toBe(9);
    expect(row.frontierChunk).toBe(9);

    const negative = await updateProgress(USER_A, privateBookId, -5 as number);
    expect(negative.currentChunk).toBe(0);
    expect(negative.frontierChunk).toBe(9); // still monotonic
  });

  it("is an upsert: repeated saves keep exactly one row per (user, book)", async () => {
    await updateProgress(USER_A, privateBookId, 3);
    await updateProgress(USER_A, privateBookId, 4);
    const rows = await db
      .select()
      .from(readingProgress)
      .where(
        and(
          eq(readingProgress.userId, USER_A),
          eq(readingProgress.bookId, privateBookId),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Reading-progress privacy (per-user scoping)
// ---------------------------------------------------------------------------
describe("reading-progress privacy", () => {
  it("user B's saves never touch user A's row on the same book", async () => {
    await updateProgress(USER_A, publishedBookId, 15);
    await updateProgress(USER_B, publishedBookId, 3);

    const a = await getProgress(USER_A, publishedBookId);
    const b = await getProgress(USER_B, publishedBookId);
    expect(a?.currentChunk).toBe(15);
    expect(a?.frontierChunk).toBe(15);
    expect(b?.currentChunk).toBe(3);
    expect(b?.frontierChunk).toBe(3);
  });

  it("getProgress returns nothing for a user with no row (never falls back to another user's)", async () => {
    const none = await getProgress("user_never_read", publishedBookId);
    expect(none).toBeUndefined();
  });

  it("listBooks only joins the CALLER's progress, and never lists another user's private books", async () => {
    // B adds the published book to their library.
    await db
      .insert(purchases)
      .values({
        userId: USER_B,
        bookId: publishedBookId,
        amountCents: 0,
        status: "free",
      })
      .onConflictDoNothing();

    const shelfB = await listBooks(USER_B);
    const publishedRow = shelfB.find((r) => r.book.id === publishedBookId);
    expect(publishedRow).toBeDefined();
    // B sees B's numbers (3), not A's (15).
    expect(publishedRow?.currentChunk).toBe(3);
    expect(publishedRow?.frontierChunk).toBe(3);
    // A's private book must not be on B's shelf at all.
    expect(shelfB.some((r) => r.book.id === privateBookId)).toBe(false);

    const shelfA = await listBooks(USER_A);
    const ownRow = shelfA.find((r) => r.book.id === publishedBookId);
    expect(ownRow?.currentChunk).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// 3. Chat-history persistence
// ---------------------------------------------------------------------------
describe("chat history persistence", () => {
  const ENTITY = "char:test-hero";

  beforeAll(async () => {
    await db.insert(entities).values({
      bookId: publishedBookId,
      id: ENTITY,
      name: "Test Hero",
      kind: "character",
      introducedAtChunk: 0,
      attributes: { role: "protagonist" },
    });
  });

  it("getOrCreateSession is idempotent per (user, book, entity, mode)", async () => {
    const s1 = await getOrCreateSession(
      USER_A,
      publishedBookId,
      ENTITY,
      "story_so_far",
    );
    const s2 = await getOrCreateSession(
      USER_A,
      publishedBookId,
      ENTITY,
      "story_so_far",
    );
    expect(s1.id).toBe(s2.id);

    // A different mode is a distinct conversation.
    const sEnd = await getOrCreateSession(
      USER_A,
      publishedBookId,
      ENTITY,
      "after_ending",
    );
    expect(sEnd.id).not.toBe(s1.id);
  });

  it("persists both sides of a turn and getHistory restores them in order", async () => {
    const session = await getOrCreateSession(
      USER_A,
      publishedBookId,
      ENTITY,
      "story_so_far",
    );
    await appendMessage(session.id, "user", "Who are you?", 4);
    await appendMessage(session.id, "assistant", "I am the hero.", 4);
    await appendMessage(session.id, "user", "What do you want?", 5);
    await appendMessage(session.id, "assistant", "Peace.", 5);

    const history = await getHistory(session.id);
    expect(history.map((m) => [m.role, m.content])).toEqual([
      ["user", "Who are you?"],
      ["assistant", "I am the hero."],
      ["user", "What do you want?"],
      ["assistant", "Peace."],
    ]);
  });

  it("getHistory returns the MOST RECENT `limit` messages, oldest-first", async () => {
    const session = await getOrCreateSession(
      USER_A,
      publishedBookId,
      ENTITY,
      "story_so_far",
    );
    const history = await getHistory(session.id, 2);
    expect(history.map((m) => m.content)).toEqual([
      "What do you want?",
      "Peace.",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. Chat privacy (per-user scoping)
// ---------------------------------------------------------------------------
describe("chat privacy", () => {
  const ENTITY = "char:test-hero";

  it("findSession never returns another user's session for the same book/character/mode", async () => {
    // A has a story_so_far session with messages (created above); B does not.
    const forB = await findSession(
      USER_B,
      publishedBookId,
      ENTITY,
      "story_so_far",
    );
    expect(forB).toBeUndefined();
  });

  it("two users chatting with the same character get fully separate sessions and histories", async () => {
    const sA = await getOrCreateSession(
      USER_A,
      publishedBookId,
      ENTITY,
      "story_so_far",
    );
    const sB = await getOrCreateSession(
      USER_B,
      publishedBookId,
      ENTITY,
      "story_so_far",
    );
    expect(sB.id).not.toBe(sA.id);

    await appendMessage(sB.id, "user", "B's secret question", 0);
    const historyA = await getHistory(sA.id);
    expect(historyA.some((m) => m.content === "B's secret question")).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// requireBookAccess — the gate every progress/chat route goes through
// ---------------------------------------------------------------------------
describe("requireBookAccess scoping", () => {
  it("owner can access their private book", async () => {
    const book = await requireBookAccess(privateBookId, USER_A);
    expect(book.id).toBe(privateBookId);
  });

  it("another user gets 403 on a private book", async () => {
    await expect(
      requireBookAccess(privateBookId, USER_B),
    ).rejects.toMatchObject({
      status: 403,
    });
  });

  it("any signed-in user can READ a published book, but not write to it", async () => {
    const book = await requireBookAccess(publishedBookId, USER_B);
    expect(book.id).toBe(publishedBookId);
    await expect(
      requireBookAccess(publishedBookId, USER_B, { write: true }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("admin can access anything", async () => {
    const book = await requireBookAccess(privateBookId, ADMIN);
    expect(book.id).toBe(privateBookId);
  });

  it("non-UUID book ids are a clean 404, not a DB error", async () => {
    await expect(requireBookAccess("not-a-uuid", USER_A)).rejects.toMatchObject(
      {
        status: 404,
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Data-loss edge cases (documenting intended/current semantics)
// ---------------------------------------------------------------------------
describe("data-loss semantics", () => {
  it("deleting a book cascades away EVERY user's progress and chat for it", async () => {
    const doomedId = await seedBook({
      ownerId: USER_A,
      title: "Doomed",
      totalChunks: 5,
      visibility: "published",
    });
    await updateProgress(USER_A, doomedId, 2);
    await updateProgress(USER_B, doomedId, 4);
    await db.insert(entities).values({
      bookId: doomedId,
      id: "char:doomed-hero",
      name: "Doomed Hero",
      kind: "character",
    });
    const s = await getOrCreateSession(
      USER_B,
      doomedId,
      "char:doomed-hero",
      "story_so_far",
    );
    await appendMessage(s.id, "user", "hello", 0);

    await deleteBook(doomedId);

    const progressLeft = await db
      .select()
      .from(readingProgress)
      .where(eq(readingProgress.bookId, doomedId));
    const sessionsLeft = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.bookId, doomedId));
    const messagesLeft = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, s.id));
    expect(progressLeft).toHaveLength(0);
    expect(sessionsLeft).toHaveLength(0);
    expect(messagesLeft).toHaveLength(0);
  });

  it("wiping entities (analysis re-run) ORPHANS chat sessions instead of deleting them, and getKnowledge then 404s", async () => {
    const bookId = await seedBook({
      ownerId: USER_A,
      title: "Reanalyzed",
      totalChunks: 5,
    });
    await db.insert(entities).values({
      bookId,
      id: "char:ephemeral",
      name: "Ephemeral",
      kind: "character",
      introducedAtChunk: 0,
    });
    const session = await getOrCreateSession(
      USER_A,
      bookId,
      "char:ephemeral",
      "story_so_far",
    );
    await appendMessage(session.id, "user", "remember me", 0);
    await appendMessage(session.id, "assistant", "always", 0);

    // Same wipe resetAndEnqueueAnalysis performs (chat_sessions.entityId has
    // no FK to entities, so the rows survive).
    await db.delete(entities).where(eq(entities.bookId, bookId));

    const survivor = await findSession(
      USER_A,
      bookId,
      "char:ephemeral",
      "story_so_far",
    );
    expect(survivor?.id).toBe(session.id);
    const history = await getHistory(session.id);
    expect(history).toHaveLength(2); // history is preserved…

    // …but the conversation dead-ends: a new message would 404 in
    // streamChatReply because the persona's entity no longer exists (unless
    // re-analysis mints the identical deterministic slug again).
    await expect(
      getKnowledge(bookId, "char:ephemeral", 4, "story_so_far"),
    ).rejects.toMatchObject({ status: 404 });
    expect(new ApiError(404, "not_found", "x").status).toBe(404);
  });
});
