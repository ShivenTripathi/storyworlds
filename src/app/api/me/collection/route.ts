import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getCollectionOverview } from "@/services/analytics";

/**
 * Cross-book discovery progress for every book the caller has opened — the
 * Discoveries page's collection grid (title, archetype, cast met/total,
 * overall progress). Strictly the caller's own rows — getCollectionOverview
 * scopes its queries to the authenticated userId.
 */
export async function GET() {
  try {
    await dbReady;
    const { userId } = await requireUser();

    const collection = await getCollectionOverview(userId);

    return NextResponse.json({ collection });
  } catch (e) {
    return handleApiError(e);
  }
}
