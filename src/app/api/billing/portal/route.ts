import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { createPortalSession } from "@/services/billing";

export async function POST() {
  try {
    const { userId } = await requireUser();
    const result = await createPortalSession(userId);
    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e);
  }
}
