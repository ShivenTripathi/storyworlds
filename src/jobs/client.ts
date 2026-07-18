import { Inngest } from "inngest";

/**
 * Shared Inngest client for the Story Worlds analysis pipeline. Functions
 * are registered in `src/jobs/*.ts` and served from
 * `src/app/api/inngest/route.ts`.
 *
 * Event contract (payloads live at the send/trigger sites):
 *  - `book/analyze.requested`   { bookId, jobId } — full-book analysis
 *  - `overlay/prefetch.requested` { bookId, fromIdx, count } — page overlays
 *  - `catalog/ingest.requested` (no data) — pull next Gutenberg seed book
 *  - `analysis/sweep.requested`, `overlay/sweep.requested`,
 *    `cover/sweep.requested`, `funfacts/sweep.requested` (no data) — manual
 *    triggers for the always-on sweepers (src/jobs/sweep-*.ts); a cron tick
 *    is what normally drives those, these let an admin action (or a test)
 *    force an immediate tick.
 */
export const inngest = new Inngest({ id: "storyworlds" });
