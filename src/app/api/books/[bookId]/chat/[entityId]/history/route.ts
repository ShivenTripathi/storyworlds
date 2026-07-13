import { NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { findSession, getHistory } from "@/services/chat";

type Params = { params: Promise<{ bookId: string; entityId: string }> };

const HISTORY_LIMIT = 30;

const querySchema = z.object({
  mode: z.enum(["story_so_far", "after_ending"]),
});

export async function GET(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId, entityId } = await params;
    const { userId } = await requireUser();
    await requireBookAccess(bookId, userId);

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      mode: url.searchParams.get("mode"),
    });
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        "Query param 'mode' must be 'story_so_far' or 'after_ending'.",
      );
    }

    // Read-only lookup — a GET must not have the side effect of creating a
    // chat session just by being polled.
    const session = await findSession(
      userId,
      bookId,
      entityId,
      parsed.data.mode,
    );
    if (!session) {
      return NextResponse.json({ messages: [] });
    }

    const rows = await getHistory(session.id, HISTORY_LIMIT);

    return NextResponse.json({
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
