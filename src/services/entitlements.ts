import { and, count, eq, gte } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, chatMessages, chatSessions, subscriptions, users } from "@/db/schema";
import { ApiError } from "@/lib/errors";
import { env } from "@/lib/env";

export type Plan = "free" | "reader";
export type EntitlementAction = "upload" | "chat";

/**
 * Active/trialing subscription -> its plan; otherwise 'free'. Cancelled,
 * past_due, incomplete, etc. all fall back to 'free' (no access without a
 * live subscription).
 */
export async function getPlan(userId: string): Promise<Plan> {
  await dbReady;

  const [row] = await db
    .select({ plan: subscriptions.plan, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  if (row && (row.status === "active" || row.status === "trialing")) {
    return row.plan === "reader" ? "reader" : "free";
  }

  return "free";
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function limitFor(plan: Plan, action: EntitlementAction): number {
  if (action === "upload") {
    return plan === "reader" ? env.READER_UPLOADS_PER_DAY : env.FREE_UPLOADS_PER_DAY;
  }
  return plan === "reader" ? env.READER_CHAT_PER_DAY : env.FREE_CHAT_PER_DAY;
}

async function todaysUploadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(books)
    .where(and(eq(books.ownerId, userId), gte(books.createdAt, startOfUtcDay())));
  return row?.n ?? 0;
}

async function todaysChatCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(chatMessages)
    .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, startOfUtcDay()),
      ),
    );
  return row?.n ?? 0;
}

export interface UsageSnapshot {
  uploads: number;
  chats: number;
}

/** Today's (UTC) usage counts, for display on a settings/account page. */
export async function getTodayUsage(userId: string): Promise<UsageSnapshot> {
  await dbReady;
  const [uploads, chats] = await Promise.all([
    todaysUploadCount(userId),
    todaysChatCount(userId),
  ]);
  return { uploads, chats };
}

/**
 * Enforces the daily entitlement limit for `action`, throwing a 429
 * ApiError when the caller's plan-appropriate limit for today (UTC) has
 * already been reached. Admins bypass entirely.
 *
 * This is also what protects the Gemini free-tier daily quota (see
 * ZERO-COST CONSTRAINT in CLAUDE.md) — chat and upload are the only two
 * flows that trigger LLM calls, so gating them here keeps the whole app
 * under the ~1,500 RPD free-tier ceiling even with many signed-up users.
 */
export async function checkEntitlement(
  userId: string,
  action: EntitlementAction,
): Promise<void> {
  await dbReady;

  const [userRow] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userRow?.role === "admin") {
    return;
  }

  const plan = await getPlan(userId);
  const limit = limitFor(plan, action);
  const used = action === "upload" ? await todaysUploadCount(userId) : await todaysChatCount(userId);

  if (used >= limit) {
    const friendly =
      action === "upload"
        ? `You've reached today's upload limit (${limit} on the ${plan} plan). Try again tomorrow, or upgrade for a higher limit.`
        : `You've reached today's chat limit (${limit} messages on the ${plan} plan). Try again tomorrow, or upgrade for a higher limit.`;
    throw new ApiError(429, "limit_reached", friendly);
  }
}
