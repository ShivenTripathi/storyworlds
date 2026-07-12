import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getDossier } from "@/services/world";

type Params = { params: Promise<{ bookId: string; entityId: string }> };

/**
 * Enriched dossier lookup for a character. Resolves the entity by id
 * regardless of the reader's frontier (so a "Dossier →" link never dead-ends
 * on "not met"), while inner-life attributes, appearances, the illustrated
 * scene, and co-occurring characters all stay spoiler-gated by frontier —
 * see getDossier. Frontier gating is ON by default; only the book's
 * owner/admin can opt out with ?full=1 (never a plain reader).
 */
export async function GET(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId, entityId } = await params;
    const { userId, role } = await requireUser();
    const book = await requireBookAccess(bookId, userId);

    const url = new URL(req.url);
    const wantsFull = url.searchParams.get("full") === "1";
    const privileged = role === "admin" || book.ownerId === userId;
    const useFrontier = !(wantsFull && privileged);

    // Entity ids contain a colon (e.g. `char:sherlock-holmes`); Next decodes
    // path params server-side, but decode defensively so a double-encoded id
    // still resolves.
    const decodedId = decodeURIComponent(entityId);

    const dossier = await getDossier({
      bookId,
      userId,
      entityId: decodedId,
      useFrontier,
    });

    // Keep the "not met / not analyzed" contract simple for the client: a null
    // entity collapses the whole dossier to null.
    return NextResponse.json({
      dossier: dossier.entity ? dossier : null,
      themeArchetype: dossier.themeArchetype,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
