import { NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import {
  deleteHighlight,
  isHighlightColor,
  updateHighlight,
} from "@/services/annotations";

type Params = { params: Promise<{ bookId: string; id: string }> };

const patchSchema = z
  .object({
    color: z.string().trim().min(1).max(20).optional(),
    note: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((v) => v.color !== undefined || v.note !== undefined, {
    message: "Provide color and/or note.",
  });

/** PATCH /api/books/:bookId/highlights/:id — change a highlight's color and/or note. */
export async function PATCH(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId, id } = await params;
    const { userId } = await requireUser();
    await requireBookAccess(bookId, userId);

    const json = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        "Invalid body: expected { color?: string, note?: string | null }.",
      );
    }
    if (parsed.data.color && !isHighlightColor(parsed.data.color)) {
      throw new ApiError(
        400,
        "invalid_request",
        "Unsupported highlight color.",
      );
    }

    const highlight = await updateHighlight(userId, id, parsed.data);
    return NextResponse.json({ highlight });
  } catch (e) {
    return handleApiError(e);
  }
}

/** DELETE /api/books/:bookId/highlights/:id — removes one of the caller's own highlights. */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId, id } = await params;
    const { userId } = await requireUser();
    await requireBookAccess(bookId, userId);

    await deleteHighlight(userId, id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return handleApiError(e);
  }
}
