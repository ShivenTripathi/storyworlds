import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { revokeApiKey } from "@/lib/api-keys";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";

type Params = { params: Promise<{ keyId: string }> };

/** Revokes an API key. Scoped to the caller's own keys (no-op otherwise). */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { keyId } = await params;
    const { userId } = await requireUser();
    await revokeApiKey(userId, keyId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
}
