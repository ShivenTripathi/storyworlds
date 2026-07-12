import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getReadingActivity } from "@/services/analytics";

/**
 * The reading heatmap + streak stats for the shelf's Discoveries page
 * (src/components/analytics/ReadingHeatmap.tsx). Strictly the caller's own
 * rows — getReadingActivity scopes every query to the authenticated userId.
 */
export async function GET() {
  try {
    await dbReady;
    const { userId } = await requireUser();

    const activity = await getReadingActivity(userId);

    return NextResponse.json({ activity });
  } catch (e) {
    return handleApiError(e);
  }
}
