import { NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { requireAdmin } from "@/lib/admin";
import { ApiError, handleApiError } from "@/lib/errors";
import { updateFeedbackStatus } from "@/services/feedback";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  status: z.enum(["new", "triaged", "resolved"]).optional(),
  adminNote: z.string().max(4000).nullable().optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    await dbReady;
    await requireAdmin();
    const { id } = await params;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "Invalid status/admin note.");
    }

    const row = await updateFeedbackStatus(id, {
      status: parsed.data.status,
      adminNote: parsed.data.adminNote,
    });

    if (!row) {
      throw new ApiError(404, "not_found", "Feedback not found.");
    }

    return NextResponse.json({ feedback: row });
  } catch (e) {
    return handleApiError(e);
  }
}
