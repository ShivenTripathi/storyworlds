import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { getWorldForReader } from "@/services/world";

type Params = { params: Promise<{ bookId: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId } = await requireUser();
    await requireBookAccess(bookId, userId);

    const url = new URL(req.url);
    const useFrontier = url.searchParams.has("frontier");

    const world = await getWorldForReader({ bookId, userId, useFrontier });

    return NextResponse.json({ world });
  } catch (e) {
    return handleApiError(e);
  }
}
