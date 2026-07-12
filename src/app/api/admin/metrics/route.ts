import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/errors";
import { getAdminMetrics } from "@/services/analytics";

/**
 * Tier-3 admin "Press Room" metrics (docs/analytics-plan.md): engagement,
 * LLM cost/amortization, and free-tier headroom. Aggregate-only — admin-gated
 * by requireAdmin; getAdminMetrics never returns per-user/per-entity data.
 */
export async function GET() {
  try {
    await dbReady;
    await requireAdmin();

    const metrics = await getAdminMetrics();

    return NextResponse.json({ metrics });
  } catch (e) {
    return handleApiError(e);
  }
}
