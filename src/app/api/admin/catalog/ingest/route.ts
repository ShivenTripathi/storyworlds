import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { inngest } from "@/jobs/client";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

/** Lets an admin kick the catalog ingestion queue immediately instead of waiting for the cron tick. */
export async function POST() {
  try {
    await dbReady;
    const { userId } = await requireAdmin();
    rateLimit(`admin:${userId}:catalog-ingest`, { windowSeconds: 60, max: 10 });

    await inngest.send({ name: "catalog/ingest.requested", data: {} });

    return NextResponse.json({ queued: true }, { status: 202 });
  } catch (e) {
    return handleApiError(e);
  }
}
