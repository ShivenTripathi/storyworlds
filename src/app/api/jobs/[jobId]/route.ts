import { NextResponse } from "next/server";
import { dbReady } from "@/db";
import { requireJobAccess, requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { jobId } = await params;
    const { userId } = await requireUser();

    const job = await requireJobAccess(jobId, userId);

    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        stage: job.stage,
        error: job.error,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
