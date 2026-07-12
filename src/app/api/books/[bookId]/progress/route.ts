import { NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { updateProgress } from "@/services/books";

type Params = { params: Promise<{ bookId: string }> };

const bodySchema = z.object({
  currentChunk: z.number().int().min(0),
  // Optional: the furthest chunk the client reached this session, so the
  // spoiler frontier isn't under-recorded within a debounce window. Clamped +
  // never-regressing server-side (see updateProgress).
  frontierChunk: z.number().int().min(0).optional(),
});

export async function PUT(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId } = await requireUser();
    await requireBookAccess(bookId, userId);

    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        "Invalid body: expected { currentChunk: number }.",
      );
    }

    const row = await updateProgress(
      userId,
      bookId,
      parsed.data.currentChunk,
      parsed.data.frontierChunk,
    );

    return NextResponse.json({
      currentChunk: row.currentChunk,
      frontierChunk: row.frontierChunk,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
