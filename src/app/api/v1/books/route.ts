import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireApiKey } from "@/lib/api-keys";
import { handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { listBooks, toBookDto } from "@/services/books";

/**
 * Minimal public API shim, authenticated via `sw_live_...` API keys (see
 * src/lib/api-keys.ts) rather than Clerk sessions — for programmatic/
 * external access to a caller's own books.
 */
export async function GET(req: Request) {
  try {
    await dbReady;
    const { userId, keyId } = await requireApiKey(req);
    rateLimit(`key:${keyId}:v1`, { windowSeconds: 60, max: 60 });

    const rows = await listBooks(userId);
    const books = rows.map((r) => toBookDto(r.book, r));

    return NextResponse.json({ books });
  } catch (e) {
    return handleApiError(e);
  }
}
