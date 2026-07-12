import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getEntityForDossier } from "@/services/world";

type Params = { params: Promise<{ bookId: string; entityId: string }> };

/**
 * Single-entity lookup for the character dossier. Resolves the entity by id
 * regardless of the reader's frontier (so a "Dossier →" link never dead-ends
 * on "not met"), while inner-life attributes stay spoiler-gated by frontier —
 * see getEntityForDossier. Frontier gating is ON by default; only the book's
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

    const { entity, themeArchetype } = await getEntityForDossier({
      bookId,
      userId,
      entityId: decodedId,
      useFrontier,
    });

    return NextResponse.json({ entity, themeArchetype });
  } catch (e) {
    return handleApiError(e);
  }
}
