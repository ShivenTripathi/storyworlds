import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { ApiError, handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { getBook } from "@/services/books";
import { resetAndEnqueueAnalysis } from "@/services/world";

type Params = { params: Promise<{ bookId: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { userId } = await requireAdmin();
    // Defense-in-depth: even an admin (or a compromised admin session) can't
    // hammer this LLM-triggering route.
    rateLimit(`admin:${userId}:retry-analysis`, { windowSeconds: 60, max: 10 });
    const { bookId } = await params;

    const book = await getBook(bookId);
    if (!book) {
      throw new ApiError(404, "not_found", "Book not found.");
    }

    const job = await resetAndEnqueueAnalysis(bookId, userId);

    return NextResponse.json({ job }, { status: 202 });
  } catch (e) {
    return handleApiError(e);
  }
}
