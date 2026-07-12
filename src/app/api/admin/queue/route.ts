import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/errors";
import { getQueueStatus } from "@/services/queue";

export async function GET() {
  try {
    await dbReady;
    await requireAdmin();

    const status = await getQueueStatus();

    return NextResponse.json(status);
  } catch (e) {
    return handleApiError(e);
  }
}
