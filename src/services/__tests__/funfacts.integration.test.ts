/**
 * Integration test for generateFunFactsForBook (src/services/funfacts.ts)
 * against a real in-memory PGlite database, with the LLM call falling
 * through to the deterministic MockDriver (no ANTHROPIC_API_KEY/
 * GOOGLE_API_KEY set in the test process — see src/ai/client.ts).
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

import { eq } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, users } from "@/db/schema";
import { generateFunFactsForBook } from "@/services/funfacts";

const OWNER = "user_funfacts_reader";

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values({ id: OWNER, email: "f@example.com" });
});

async function insertBook(overrides: Partial<typeof books.$inferInsert> = {}) {
  const [book] = await db
    .insert(books)
    .values({
      ownerId: OWNER,
      title: "The Test of Time",
      author: "A. Uthor",
      status: "ready",
      totalChunks: 10,
      ...overrides,
    })
    .returning();
  return book;
}

describe("generateFunFactsForBook", () => {
  it("generates and persists facts for a book with no facts yet", async () => {
    const book = await insertBook();

    const result = await generateFunFactsForBook(book.id);

    expect(result).not.toBeNull();
    expect(result!.facts.length).toBeGreaterThan(0);
    for (const fact of result!.facts) {
      expect(fact.text.length).toBeGreaterThan(0);
      expect(["author", "history", "trivia", "legacy"]).toContain(
        fact.category,
      );
    }

    const [row] = await db
      .select({ funFacts: books.funFacts })
      .from(books)
      .where(eq(books.id, book.id))
      .limit(1);
    expect(row.funFacts).toEqual(result);
  });

  it("is idempotent — returns the already-stored facts rather than regenerating", async () => {
    const book = await insertBook({ title: "Another Book" });

    // Pre-seed a sentinel value the mock driver would never itself produce,
    // so a passing test proves the early-return path ran, not a coincidence.
    const sentinel = {
      facts: [
        {
          text: "SENTINEL — pre-seeded, not mock-generated.",
          category: "trivia" as const,
        },
      ],
    };
    await db
      .update(books)
      .set({ funFacts: sentinel })
      .where(eq(books.id, book.id));

    const result = await generateFunFactsForBook(book.id);
    expect(result).toEqual(sentinel);
  });

  it("returns null for a book that doesn't exist", async () => {
    const result = await generateFunFactsForBook(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(result).toBeNull();
  });
});
