import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/errors";
import { getOverview } from "@/services/admin";

export async function GET() {
  try {
    await dbReady;
    await requireAdmin();

    const overview = await getOverview();

    return NextResponse.json(overview);
  } catch (e) {
    return handleApiError(e);
  }
}
