import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireApiKey } from "@/lib/api-keys";
import { requireBookAccess } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { getWorldForReader } from "@/services/world";

type Params = { params: Promise<{ bookId: string }> };

/**
 * API-key authed counterpart to /api/books/[bookId]/world — same
 * requireBookAccess semantics (owner, admin, or published), just keyed off
 * the API key's userId instead of a Clerk session.
 */
export async function GET(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId, keyId } = await requireApiKey(req);
    rateLimit(`key:${keyId}:v1`, { windowSeconds: 60, max: 60 });

    await requireBookAccess(bookId, userId);

    const url = new URL(req.url);
    const useFrontier = url.searchParams.has("frontier");
    const world = await getWorldForReader({ bookId, userId, useFrontier });

    return NextResponse.json({ world });
  } catch (e) {
    return handleApiError(e);
  }
}
