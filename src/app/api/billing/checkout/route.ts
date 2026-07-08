import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { createCheckoutSession } from "@/services/billing";

export async function POST() {
  try {
    const { userId } = await requireUser();
    const result = await createCheckoutSession(userId);
    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e);
  }
}
