import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { submitFeedback } from "@/services/feedback";

const contextSchema = z
  .object({
    bookId: z.string().max(200).optional(),
    viewport: z
      .object({
        width: z.number().int().nonnegative(),
        height: z.number().int().nonnegative(),
      })
      .optional(),
    userAgent: z.string().max(500).optional(),
    referrer: z.string().max(500).optional(),
    appVersion: z.string().max(50).optional(),
  })
  .passthrough();

const bodySchema = z.object({
  kind: z.enum(["praise", "idea", "bug", "general"]),
  sentiment: z.enum(["up", "down"]).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  message: z.string().trim().min(1).max(4000),
  pathname: z.string().max(2000).optional(),
  context: contextSchema.optional(),
});

/**
 * Readers submit feedback from anywhere in the app via the FeedbackWidget.
 * Rate-limited per user to keep this from becoming a spam vector — the
 * limit is generous enough for genuine use (multiple bug reports across a
 * session) while blocking scripted abuse.
 */
export async function POST(req: NextRequest) {
  try {
    await dbReady;
    const { userId } = await requireUser();

    rateLimit(`user:${userId}:feedback`, { windowSeconds: 600, max: 10 });

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        "Feedback needs a type and a message (up to 4000 characters).",
      );
    }

    const row = await submitFeedback({
      userId,
      kind: parsed.data.kind,
      sentiment: parsed.data.sentiment,
      rating: parsed.data.rating,
      message: parsed.data.message,
      pathname: parsed.data.pathname,
      context: parsed.data.context,
    });

    return NextResponse.json({ feedback: row }, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
