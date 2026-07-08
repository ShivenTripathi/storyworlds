import { desc, eq, gte, sql } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, overlays, usageEvents, users, worldReferences } from "@/db/schema";

export interface AdminBookRow {
  id: string;
  title: string;
  owner: string | null;
  status: string;
  visibility: string | null;
  themeArchetype: string | null;
  totalChunks: number | null;
  analysis: { worldStatus: string | null; overlayCount: number };
  spendUsd: number;
  tokens: number;
}

export interface AdminOverview {
  books: AdminBookRow[];
  totals: { books: number; users: number; spendUsd: number; tokensToday: number };
}

/**
 * Admin "press room" overview: every book with its owner, status,
 * analysis progress, and LLM spend — plus site-wide totals. Several
 * queries kept separate and merged in JS rather than one giant join, so
 * fan-out joins (overlays, usage events) don't multiply row counts.
 */
export async function getOverview(): Promise<AdminOverview> {
  await dbReady;

  const bookRows = await db
    .select({
      id: books.id,
      title: books.title,
      ownerId: books.ownerId,
      ownerEmail: users.email,
      status: books.status,
      visibility: books.visibility,
      themeArchetype: books.themeArchetype,
      totalChunks: books.totalChunks,
    })
    .from(books)
    .leftJoin(users, eq(users.id, books.ownerId))
    .orderBy(desc(books.createdAt));

  const worldRows = await db
    .select({ bookId: worldReferences.bookId, status: worldReferences.status })
    .from(worldReferences);
  const worldByBook = new Map(worldRows.map((w) => [w.bookId, w.status]));

  const overlayCounts = await db
    .select({ bookId: overlays.bookId, count: sql<number>`count(*)::int` })
    .from(overlays)
    .where(eq(overlays.status, "ready"))
    .groupBy(overlays.bookId);
  const overlaysByBook = new Map(overlayCounts.map((o) => [o.bookId, o.count]));

  const spendRows = await db
    .select({
      bookId: usageEvents.bookId,
      spendUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)::float`,
      tokens: sql<number>`coalesce(sum(coalesce(${usageEvents.inputTokens}, 0) + coalesce(${usageEvents.outputTokens}, 0)), 0)::int`,
    })
    .from(usageEvents)
    .groupBy(usageEvents.bookId);
  const spendByBook = new Map(spendRows.map((s) => [s.bookId, s]));

  const bookDtos: AdminBookRow[] = bookRows.map((b) => {
    const spend = spendByBook.get(b.id);
    return {
      id: b.id,
      title: b.title,
      owner: b.ownerEmail ?? b.ownerId,
      status: b.status,
      visibility: b.visibility,
      themeArchetype: b.themeArchetype,
      totalChunks: b.totalChunks,
      analysis: {
        worldStatus: worldByBook.get(b.id) ?? null,
        overlayCount: overlaysByBook.get(b.id) ?? 0,
      },
      spendUsd: spend?.spendUsd ?? 0,
      tokens: spend?.tokens ?? 0,
    };
  });

  const [{ userCount }] = await db
    .select({ userCount: sql<number>`count(*)::int` })
    .from(users);

  const totalSpend = bookDtos.reduce((acc, b) => acc + b.spendUsd, 0);

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const [{ tokensToday }] = await db
    .select({
      tokensToday: sql<number>`coalesce(sum(coalesce(${usageEvents.inputTokens}, 0) + coalesce(${usageEvents.outputTokens}, 0)), 0)::int`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, todayStart));

  return {
    books: bookDtos,
    totals: {
      books: bookDtos.length,
      users: userCount,
      spendUsd: totalSpend,
      tokensToday,
    },
  };
}
