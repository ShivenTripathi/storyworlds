import { eq, sql } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, usageEvents } from "@/db/schema";
import { ApiError } from "@/lib/errors";

/**
 * Every LLM/image call is metered through `usageEvents` (see
 * src/ai/client.ts's `recordUsage`). This checks the running total for a
 * book against `books.tokenBudgetUsd` and throws a friendly 402 once it's
 * exceeded.
 *
 * Currently dormant in practice: the default model slots all point at the
 * Google AI Studio free tier (see PRICE_TABLE in src/ai/client.ts), which
 * bills $0 per token, so `spentUsd` never grows under the zero-cost profile.
 * It stays wired so a future paid model slot (or a book owner raising
 * tokenBudgetUsd) is enforced without further changes.
 */
export async function assertBudget(bookId: string): Promise<void> {
  await dbReady;

  const [book] = await db
    .select({ tokenBudgetUsd: books.tokenBudgetUsd })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);

  if (!book) {
    // Let the caller's own existence check produce the 404 — budget isn't
    // the right error for "book not found".
    return;
  }

  const budgetUsd = book.tokenBudgetUsd === null ? null : Number(book.tokenBudgetUsd);
  if (budgetUsd === null || !Number.isFinite(budgetUsd)) {
    return;
  }

  const [row] = await db
    .select({ spent: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(eq(usageEvents.bookId, bookId));

  const spentUsd = Number(row?.spent ?? 0);

  if (spentUsd >= budgetUsd) {
    throw new ApiError(
      402,
      "budget_exceeded",
      "This book has reached its AI usage budget. Please contact support to raise it.",
    );
  }
}
