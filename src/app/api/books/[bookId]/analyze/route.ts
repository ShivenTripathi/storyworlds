import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, dbReady } from "@/db";
import { entities, entityAliases, jobs, worldReferences } from "@/db/schema";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { inngest } from "@/jobs/client";

type Params = { params: Promise<{ bookId: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId } = await requireUser();
    const book = await requireBookAccess(bookId, userId, { write: true });

    if (book.status !== "ready") {
      throw new ApiError(
        409,
        "book_not_ready",
        "Book must finish extraction before it can be analyzed.",
      );
    }

    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";

    const [existingJob] = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.bookId, bookId),
          eq(jobs.kind, "analyze_book"),
          inArray(jobs.status, ["queued", "running"]),
        ),
      )
      .limit(1);

    // Only treat an in-flight job as blocking if it's actually making progress.
    // A dropped Inngest event (e.g. an unsynced deployment) can leave a job
    // "queued" forever; without this staleness check the book would be
    // permanently un-analyzable. Stale jobs are marked failed and a fresh run
    // is enqueued below.
    if (existingJob) {
      const updatedAt = existingJob.updatedAt ?? existingJob.createdAt;
      const ageMs = Date.now() - new Date(updatedAt).getTime();
      const staleMs = existingJob.status === "queued" ? 90_000 : 15 * 60_000;
      if (ageMs < staleMs) {
        return NextResponse.json({ job: existingJob }, { status: 200 });
      }
      await db
        .update(jobs)
        .set({ status: "failed", error: "Timed out; superseded by a new run." })
        .where(eq(jobs.id, existingJob.id));
    }

    const [world] = await db
      .select()
      .from(worldReferences)
      .where(eq(worldReferences.bookId, bookId))
      .limit(1);

    if (world?.status === "completed") {
      if (!force) {
        return NextResponse.json(
          { error: { code: "already_analyzed", message: "This book has already been analyzed." } },
          { status: 409 },
        );
      }

      // force=1: wipe existing world/entities/aliases before re-running.
      await db.delete(entityAliases).where(eq(entityAliases.bookId, bookId));
      await db.delete(entities).where(eq(entities.bookId, bookId));
      await db.delete(worldReferences).where(eq(worldReferences.bookId, bookId));
    }

    const [job] = await db
      .insert(jobs)
      .values({
        bookId,
        userId,
        kind: "analyze_book",
        status: "queued",
        progress: 0,
        stage: "Queued…",
      })
      .returning();

    await inngest.send({
      name: "book/analyze.requested",
      data: { bookId, jobId: job.id },
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (e) {
    return handleApiError(e);
  }
}
