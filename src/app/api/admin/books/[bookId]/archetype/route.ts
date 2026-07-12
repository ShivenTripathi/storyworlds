import { NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { ApiError, handleApiError } from "@/lib/errors";
import { setThemeArchetype, toBookDto } from "@/services/books";
import { ARCHETYPES } from "@/theme/archetypes";

type Params = { params: Promise<{ bookId: string }> };

const bodySchema = z.object({
  archetype: z.enum(ARCHETYPES),
});

export async function POST(req: Request, { params }: Params) {
  try {
    await dbReady;
    await requireAdmin();
    const { bookId } = await params;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "Invalid archetype.");
    }

    const book = await setThemeArchetype(bookId, parsed.data.archetype);
    if (!book) {
      throw new ApiError(404, "not_found", "Book not found.");
    }

    return NextResponse.json({ book: await toBookDto(book) });
  } catch (e) {
    return handleApiError(e);
  }
}
