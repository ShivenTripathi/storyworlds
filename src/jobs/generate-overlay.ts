import { generateOverlayCore } from "@/services/overlays";
import { inngest } from "./client";

/**
 * Prefetches overlays for the next few pages after a reader's current
 * position, so the reader (usually) never sees a "generating…" state.
 * `generateOverlayCore` is itself lock-protected and idempotent (it fast-
 * exits on rows that are already 'ready' or already being generated), so
 * this is safe to fire redundantly from every page-view.
 *
 * Concurrency is capped at 1 across ALL prefetch runs (not just per book) to
 * respect the Gemini free-tier RPM ceiling (see ZERO-COST CONSTRAINT in
 * CLAUDE.md) — overlay generation competes with the main analysis pipeline
 * for the same rate-limited quota.
 */
export const generateOverlayPrefetch = inngest.createFunction(
  {
    id: "generate-overlay-prefetch",
    concurrency: 1,
    triggers: [{ event: "overlay/prefetch.requested" }],
  },
  async ({ event }) => {
    const { bookId, fromIdx, count } = event.data as {
      bookId: string;
      fromIdx: number;
      count: number;
    };

    for (let idx = fromIdx + 1; idx <= fromIdx + count; idx++) {
      try {
        await generateOverlayCore(bookId, idx);
      } catch (err) {
        console.error(
          `[generate-overlay] prefetch failed for book ${bookId} chunk ${idx}:`,
          err,
        );
      }
    }
  },
);
