import { dbReady } from "@/db";
import { jobs } from "@/db/schema";
import { requireJobAccess, requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ jobId: string }> };

const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_DURATION_MS = 240_000;

type JobRow = typeof jobs.$inferSelect;

// Re-validates access on every poll tick (not just once up front) so a job
// that's reassigned or a caller whose access is revoked stops streaming
// mid-flight rather than leaking updates for the stream's full lifetime.
async function loadJob(jobId: string, userId: string): Promise<JobRow> {
  await dbReady;
  return requireJobAccess(jobId, userId);
}

function jobSnapshotKey(job: JobRow): string {
  return `${job.updatedAt?.toISOString?.() ?? ""}:${job.progress}:${job.status}:${job.stage}`;
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const { userId } = await requireUser();

    // Validate access before opening the stream.
    await loadJob(jobId, userId);

    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const startedAt = Date.now();
        let lastKey: string | null = null;
        let lastHeartbeat = Date.now();

        const safeClose = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        const enqueue = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };

        while (!closed) {
          if (Date.now() - startedAt > MAX_DURATION_MS) {
            safeClose();
            break;
          }

          let job: JobRow;
          try {
            job = await loadJob(jobId, userId);
          } catch {
            safeClose();
            break;
          }

          const key = jobSnapshotKey(job);
          if (key !== lastKey) {
            lastKey = key;
            const payload = {
              id: job.id,
              status: job.status,
              progress: job.progress,
              stage: job.stage,
              error: job.error,
            };
            enqueue(`data: ${JSON.stringify(payload)}\n\n`);

            if (job.status === "completed" || job.status === "failed") {
              safeClose();
              break;
            }
          }

          if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
            lastHeartbeat = Date.now();
            enqueue(`: hb\n\n`);
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      },
      cancel() {
        closed = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
