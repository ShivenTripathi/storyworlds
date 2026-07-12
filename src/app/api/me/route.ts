import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, dbReady } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { handleApiError } from "@/lib/errors";
import { getPlan, getTodayUsage } from "@/services/entitlements";

/**
 * Account summary consumed by the settings page: who the caller is, their
 * plan, today's (UTC) usage, and the limits that apply to their plan.
 */
export async function GET() {
  try {
    await dbReady;
    const { userId, role } = await requireUser();

    const [[userRow], plan, todayUsage] = await Promise.all([
      db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
      getPlan(userId),
      getTodayUsage(userId),
    ]);

    const limits =
      plan === "reader"
        ? {
            uploads: env.READER_UPLOADS_PER_DAY,
            chats: env.READER_CHAT_PER_DAY,
          }
        : { uploads: env.FREE_UPLOADS_PER_DAY, chats: env.FREE_CHAT_PER_DAY };

    return NextResponse.json({
      user: { id: userId, email: userRow?.email ?? null, role },
      // Shape must match MeResponse in src/components/settings/types.ts — the
      // settings UI reads `plan.isFree` to decide whether to show the upgrade
      // CTA. Emitting a bare string here silently killed that funnel.
      plan: { name: plan, isFree: plan !== "reader" },
      todayUsage,
      limits,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
