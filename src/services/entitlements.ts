import { and, count, eq, gte, ne, or, isNull } from "drizzle-orm";
import { db, dbReady } from "@/db";
import {
  books,
  chatMessages,
  chatSessions,
  subscriptions,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/errors";
import { env } from "@/lib/env";
import type { PricingTier } from "@/services/books";

export type Plan = "free" | "reader";
export type EntitlementAction = "upload" | "chat";

/**
 * Public contributions are heavily subsidized relative to private
 * ("premium") uploads: their analysis cost is amortized across every
 * reader who adds the book (see CLAUDE.md "THE MODEL"), so a contributor
 * gets a much larger daily allowance than a private upload consumes.
 *
 * This multiplier is the DORMANT stand-in for real Stripe-priced SKUs.
 * TODO(billing): once BILLING_ENABLED flips on, replace this flat
 * multiplier with real metered pricing — e.g. private uploads consume
 * paid credits 1:1, public contributions cost the uploader nothing (or
 * earn credits back) because the platform amortizes the LLM spend across
 * every subsequent reader.
 */
const PUBLIC_CONTRIBUTION_QUOTA_MULTIPLIER = 5;

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
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function limitFor(plan: Plan, action: EntitlementAction): number {
  if (action === "upload") {
    return plan === "reader"
      ? env.READER_UPLOADS_PER_DAY
      : env.FREE_UPLOADS_PER_DAY;
  }
  return plan === "reader" ? env.READER_CHAT_PER_DAY : env.FREE_CHAT_PER_DAY;
}

/**
 * Counts today's uploads for `userId`, optionally restricted to one side of
 * the pricing-tier split. 'private_premium' also matches legacy rows with a
 * null pricingTier (pre-migration books, always private before this model
 * existed) so old quota behavior doesn't silently loosen.
 */
async function todaysUploadCount(
  userId: string,
  tier?: "private_premium" | "public_subsidized",
): Promise<number> {
  const conditions = [
    eq(books.ownerId, userId),
    gte(books.createdAt, startOfUtcDay()),
  ];
  if (tier === "public_subsidized") {
    conditions.push(eq(books.pricingTier, "public_subsidized"));
  } else if (tier === "private_premium") {
    conditions.push(
      or(
        ne(books.pricingTier, "public_subsidized"),
        isNull(books.pricingTier),
      )!,
    );
  }
  const [row] = await db
    .select({ n: count() })
    .from(books)
    .where(and(...conditions));
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

export interface CheckEntitlementOptions {
  /**
   * Only meaningful for action='upload'. Determines which side of the
   * pricing-tier split the daily quota is checked against — see THE MODEL
   * in CLAUDE.md and PUBLIC_CONTRIBUTION_QUOTA_MULTIPLIER above. Defaults
   * to 'private_premium' (the expensive, non-amortizable path) when
   * omitted, so existing callers that don't pass this keep today's
   * behavior.
   */
  pricingTier?: PricingTier;
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
 *
 * Cost rationale (see CLAUDE.md "THE MODEL"): a private upload's analysis
 * is never shared, so its LLM cost is only ever amortized across one
 * reader — it consumes the full (expensive) daily quota. A public
 * contribution's analysis is shared across every reader who later adds the
 * book, so it's subsidized: it's checked against a separately-counted,
 * much larger allowance (PUBLIC_CONTRIBUTION_QUOTA_MULTIPLIER) instead of
 * competing with private uploads for the same small bucket.
 */
export async function checkEntitlement(
  userId: string,
  action: EntitlementAction,
  opts: CheckEntitlementOptions = {},
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

  if (action === "chat") {
    const limit = limitFor(plan, action);
    const used = await todaysChatCount(userId);
    if (used >= limit) {
      throw new ApiError(
        429,
        "limit_reached",
        `You've reached today's chat limit (${limit} messages on the ${plan} plan). Try again tomorrow, or upgrade for a higher limit.`,
      );
    }
    return;
  }

  const isContribution = opts.pricingTier === "public_subsidized";
  const baseLimit = limitFor(plan, action);
  const limit = isContribution
    ? baseLimit * PUBLIC_CONTRIBUTION_QUOTA_MULTIPLIER
    : baseLimit;
  const used = await todaysUploadCount(
    userId,
    isContribution ? "public_subsidized" : "private_premium",
  );

  if (used >= limit) {
    const friendly = isContribution
      ? `You've reached today's contribution limit (${limit} on the ${plan} plan). Thank you for growing the shared library — try again tomorrow.`
      : `You've reached today's upload limit (${limit} on the ${plan} plan). Try again tomorrow, or contribute the book to the public library for a much higher allowance, or upgrade for a higher limit.`;
    throw new ApiError(429, "limit_reached", friendly);
  }
}
