/**
 * Integration test for src/services/feedback.ts against a real in-memory
 * PGlite database: submitFeedback persists the caller's userId + traced
 * pathname/context, listFeedback returns newest-first rows joined with the
 * submitter's email (plus correct kind/sentiment counts, respecting
 * status/kind filters), and updateFeedbackStatus patches status/adminNote.
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
import { users } from "@/db/schema";
import {
  listFeedback,
  submitFeedback,
  updateFeedbackStatus,
} from "@/services/feedback";

const READER_A = "user_feedback_a";
const READER_B = "user_feedback_b";

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values([
    { id: READER_A, email: "reader-a@example.com" },
    { id: READER_B, email: "reader-b@example.com" },
  ]);
});

describe("submitFeedback", () => {
  it("persists with the caller's userId and traced pathname/context", async () => {
    const row = await submitFeedback({
      userId: READER_A,
      kind: "bug",
      sentiment: "down",
      message: "The World rail flickers on Safari.",
      pathname: "/books/abc-123/read",
      context: {
        bookId: "abc-123",
        viewport: { width: 390, height: 844 },
        userAgent: "test-agent/1.0",
        referrer: "https://example.com",
      },
    });

    expect(row.userId).toBe(READER_A);
    expect(row.userEmail).toBe("reader-a@example.com");
    expect(row.kind).toBe("bug");
    expect(row.sentiment).toBe("down");
    expect(row.status).toBe("new");
    expect(row.pathname).toBe("/books/abc-123/read");
    expect(row.context).toMatchObject({
      bookId: "abc-123",
      viewport: { width: 390, height: 844 },
      userAgent: "test-agent/1.0",
      referrer: "https://example.com",
    });
    expect(row.adminNote).toBeNull();
  });
});

describe("listFeedback", () => {
  beforeAll(async () => {
    // Seed a few more rows spread across kinds/sentiments/users, on top of
    // the bug report inserted above, so ordering + filters + counts are all
    // exercised against a non-trivial set.
    await submitFeedback({
      userId: READER_B,
      kind: "idea",
      message: "Would love a dark-mode-only reading theme.",
      pathname: "/shelf",
    });
    await submitFeedback({
      userId: READER_A,
      kind: "praise",
      sentiment: "up",
      message: "The codex is delightful.",
      pathname: "/books/abc-123",
    });
    await submitFeedback({
      userId: READER_B,
      kind: "general",
      message: "Just saying hi.",
    });
  });

  it("returns newest-first rows with the submitter's email", async () => {
    const { items } = await listFeedback();
    expect(items.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        items[i].createdAt.getTime(),
      );
    }
    const generalRow = items.find((r) => r.kind === "general");
    expect(generalRow?.userEmail).toBe("reader-b@example.com");
  });

  it("reports correct aggregate counts by kind and sentiment", async () => {
    const { counts } = await listFeedback();
    expect(counts.byKind.bug).toBe(1);
    expect(counts.byKind.idea).toBe(1);
    expect(counts.byKind.praise).toBe(1);
    expect(counts.byKind.general).toBe(1);
    expect(counts.bySentiment.up).toBe(1);
    expect(counts.bySentiment.down).toBe(1);
    expect(counts.bySentiment.none).toBe(2);
  });

  it("respects the kind filter", async () => {
    const { items } = await listFeedback({ kind: "idea" });
    expect(items).toHaveLength(1);
    expect(items[0].message).toContain("dark-mode-only");
  });

  it("respects the status filter", async () => {
    const allNew = await listFeedback({ status: "new" });
    expect(allNew.items.length).toBeGreaterThanOrEqual(4);

    const resolved = await listFeedback({ status: "resolved" });
    expect(resolved.items).toHaveLength(0);
  });
});

describe("updateFeedbackStatus", () => {
  it("patches status and admin note", async () => {
    const created = await submitFeedback({
      userId: READER_A,
      kind: "bug",
      message: "Overlay image never loads for chapter 3.",
    });

    const triaged = await updateFeedbackStatus(created.id, {
      status: "triaged",
    });
    expect(triaged?.status).toBe("triaged");
    expect(triaged?.adminNote).toBeNull();

    const noted = await updateFeedbackStatus(created.id, {
      adminNote: "Repro'd — missing image storage key.",
    });
    expect(noted?.status).toBe("triaged");
    expect(noted?.adminNote).toBe("Repro'd — missing image storage key.");

    const resolved = await updateFeedbackStatus(created.id, {
      status: "resolved",
    });
    expect(resolved?.status).toBe("resolved");

    const { items } = await listFeedback({ status: "resolved" });
    expect(items.some((r) => r.id === created.id)).toBe(true);
  });

  it("returns null for a nonexistent id", async () => {
    const result = await updateFeedbackStatus(
      "00000000-0000-0000-0000-000000000000",
      { status: "triaged" },
    );
    expect(result).toBeNull();
  });
});
