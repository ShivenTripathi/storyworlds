import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, dbReady } from "@/db";
import { jobs, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";

type Params = { params: Promise<{ jobId: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: Params) {
  try {
    await dbReady;
    const { jobId } = await params;
    const { userId } = await requireUser();

    if (!UUID_RE.test(jobId)) {
      throw new ApiError(404, "not_found", "Job not found.");
    }

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) {
      throw new ApiError(404, "not_found", "Job not found.");
    }

    if (job.userId !== userId) {
      const [user] = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (user?.role !== "admin") {
        throw new ApiError(404, "not_found", "Job not found.");
      }
    }

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
