import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getCodexForBook } from "@/services/analytics";

type Params = { params: Promise<{ bookId: string }> };

/**
 * The gamified Codex card grid for a book. Spoiler-gated by the SAME
 * frontier rule as /api/books/{id}/world — a reader only sees 'known'/'met'
 * cards for entities they've reached; everything else comes back as a bare
 * `{state:'locked', kind, slot}` silhouette. Only the book's owner or an
 * admin gets the unfiltered (isOwnerOrAdmin) full view, and never via a
 * client-controlled query param (mirrors the world route's ?full=1 guard).
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId, role } = await requireUser();
    const book = await requireBookAccess(bookId, userId);

    const isOwnerOrAdmin = role === "admin" || book.ownerId === userId;

    const codex = await getCodexForBook({ userId, bookId, isOwnerOrAdmin });

    return NextResponse.json(codex);
  } catch (e) {
    return handleApiError(e);
  }
}
