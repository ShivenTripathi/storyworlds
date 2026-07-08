import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, dbReady } from "@/db";
import { worldReferences } from "@/db/schema";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { getOrGenerateOverlay, requestPrefetch } from "@/services/overlays";

type Params = { params: Promise<{ bookId: string; idx: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId, idx: idxRaw } = await params;
    const idx = Number(idxRaw);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new ApiError(400, "invalid_request", "Invalid chunk index.");
    }

    const { userId } = await requireUser();
    const book = await requireBookAccess(bookId, userId);

    if (book.totalChunks === null || idx >= book.totalChunks) {
      throw new ApiError(404, "not_found", "Chunk not found.");
    }

    const [world] = await db
      .select({ status: worldReferences.status })
      .from(worldReferences)
      .where(eq(worldReferences.bookId, bookId))
      .limit(1);

    if (!world || world.status !== "completed") {
      return NextResponse.json(
        {
          error: {
            code: "world_not_ready",
            message: "Analysis has not completed for this book yet.",
          },
        },
        { status: 409 },
      );
    }

    const result = await getOrGenerateOverlay(bookId, idx, userId);

    // Fire-and-forget: warm the next few pages regardless of whether this
    // request itself generated fresh or hit an already-ready row.
    void requestPrefetch(bookId, idx);

    if ("pending" in result) {
      return NextResponse.json({ pending: true }, { status: 202 });
    }

    return NextResponse.json({ overlay: result }, { status: 200 });
  } catch (e) {
    return handleApiError(e);
  }
}
