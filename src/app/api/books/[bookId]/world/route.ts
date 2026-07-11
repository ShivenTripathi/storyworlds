import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getWorldForReader } from "@/services/world";

type Params = { params: Promise<{ bookId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId, role } = await requireUser();
    const book = await requireBookAccess(bookId, userId);

    // Frontier (spoiler) filtering is ON by default. The full, unfiltered
    // world is only served to the book's owner or an admin when they
    // explicitly opt in with ?full=1 (e.g. admin archetype preview) — a
    // reader can never lift their own spoiler gate via a query param.
    const url = new URL(req.url);
    const wantsFull = url.searchParams.get("full") === "1";
    const privileged = role === "admin" || book.ownerId === userId;
    const useFrontier = !(wantsFull && privileged);

    const world = await getWorldForReader({ bookId, userId, useFrontier });

    return NextResponse.json({ world });
  } catch (e) {
    return handleApiError(e);
  }
}
