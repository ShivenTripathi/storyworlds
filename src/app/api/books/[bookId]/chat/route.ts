import { z } from "zod";
import { dbReady } from "@/db";
import { requireBookAccess, requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { streamChatReply } from "@/services/chat";
import { checkEntitlement } from "@/services/entitlements";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ bookId: string }> };

const bodySchema = z.object({
  entityId: z.string().min(1),
  mode: z.enum(["story_so_far", "after_ending"]),
  message: z.string().min(1).max(2000),
  chunkIdx: z.number().int().min(0),
  acknowledgeSpoilers: z.boolean().optional(),
});

/**
 * Streams a character's reply over SSE as
 *   data: {"delta": "..."}          (one per token/word chunk)
 *   data: {"done": true, "messageId": <id>}   (once, at the end)
 * or, if the model call fails mid-stream,
 *   data: {"error": "..."}
 * followed by the stream closing either way.
 *
 * Auth/validation/spoiler-gate failures (bad body, no access, budget
 * exceeded, spoiler gate) happen BEFORE the stream opens and are surfaced as
 * a normal JSON error response via `handleApiError`, not an SSE frame.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    await dbReady;
    const { bookId } = await params;
    const { userId } = await requireUser();
    await requireBookAccess(bookId, userId);

    rateLimit(`user:${userId}:chat`, { windowSeconds: 60, max: 10 });
    // Also protects the Gemini free-tier daily quota (see ZERO-COST
    // CONSTRAINT in CLAUDE.md) — this is the only path that calls the chat
    // model.
    await checkEntitlement(userId, "chat");

    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        "Invalid body: expected { entityId, mode, message, chunkIdx, acknowledgeSpoilers? }.",
      );
    }

    const result = await streamChatReply({
      userId,
      bookId,
      entityId: parsed.data.entityId,
      mode: parsed.data.mode,
      message: parsed.data.message,
      chunkIdx: parsed.data.chunkIdx,
      acknowledgeSpoilers: parsed.data.acknowledgeSpoilers,
    });

    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
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

        try {
          for await (const delta of result.stream) {
            enqueue(`data: ${JSON.stringify({ delta })}\n\n`);
          }
          const messageId = await result.assistantMessageId;
          enqueue(`data: ${JSON.stringify({ done: true, messageId })}\n\n`);
        } catch (err) {
          console.error(`[api] chat stream failed for book ${bookId}:`, err);
          enqueue(
            `data: ${JSON.stringify({ error: "The character couldn't respond. Please try again." })}\n\n`,
          );
        } finally {
          safeClose();
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
