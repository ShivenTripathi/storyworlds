import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getReaderStats } from "@/services/analytics";

/**
 * Cross-book reader stats for the shelf's "Your Reading" dashboard
 * (docs/analytics-plan.md Tier 1). Strictly the caller's own rows —
 * getReaderStats scopes every query to the authenticated userId.
 */
export async function GET() {
  try {
    await dbReady;
    const { userId } = await requireUser();

    const stats = await getReaderStats(userId);

    return NextResponse.json({ stats });
  } catch (e) {
    return handleApiError(e);
  }
}
