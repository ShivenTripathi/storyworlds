import { NextRequest, NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/errors";
import { listFeedback } from "@/services/feedback";
import type { FeedbackKind, FeedbackStatus } from "@/services/feedback";

const STATUSES: FeedbackStatus[] = ["new", "triaged", "resolved"];
const KINDS: FeedbackKind[] = ["praise", "idea", "bug", "general"];

export async function GET(req: NextRequest) {
  try {
    await dbReady;
    await requireAdmin();

    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const kindParam = url.searchParams.get("kind");

    const status = STATUSES.find((s) => s === statusParam);
    const kind = KINDS.find((k) => k === kindParam);

    const { items, counts } = await listFeedback({ status, kind });

    return NextResponse.json({ items, counts });
  } catch (e) {
    return handleApiError(e);
  }
}
