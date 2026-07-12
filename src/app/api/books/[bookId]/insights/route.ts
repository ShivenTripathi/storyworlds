import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getStoryInsights } from "@/services/analytics";

type Params = { params: Promise<{ bookId: string }> };

/**
 * Tier-2 story-world insights (docs/analytics-plan.md): character network,
 * screen-time, and a frontier-filtered timeline spine. Same auth + frontier
 * convention as GET /api/books/[bookId]/world — frontier filtering is ON by
 * default; only the book's owner or an admin can see the unfiltered view,
 * and only when they explicitly opt in with ?full=1 (never a plain reader,
 * and never the owner/admin's default view either — they still read their
 * own book spoiler-free).
 */
export async function GET(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId, role } = await requireUser();
    const book = await requireBookAccess(bookId, userId);

    const url = new URL(req.url);
    const wantsFull = url.searchParams.get("full") === "1";
    const privileged = role === "admin" || book.ownerId === userId;
    const isOwnerOrAdmin = wantsFull && privileged;

    const insights = await getStoryInsights({ bookId, userId, isOwnerOrAdmin });

    return NextResponse.json({ insights });
  } catch (e) {
    return handleApiError(e);
  }
}
