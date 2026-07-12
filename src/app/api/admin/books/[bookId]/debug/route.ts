import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { ApiError, handleApiError } from "@/lib/errors";
import { getBookDebug } from "@/services/admin-debug";

type Params = { params: Promise<{ bookId: string }> };

/**
 * Full, unfiltered debug picture for one book — the privileged admin
 * inspection view (see src/services/admin-debug.ts). Admin-only.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    await dbReady;
    await requireAdmin();
    const { bookId } = await params;

    const debug = await getBookDebug(bookId);
    if (!debug) {
      throw new ApiError(404, "not_found", "Book not found.");
    }

    return NextResponse.json(debug);
  } catch (e) {
    return handleApiError(e);
  }
}
