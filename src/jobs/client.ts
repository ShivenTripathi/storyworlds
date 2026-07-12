import { Inngest } from "inngest";

/**
 * Shared Inngest client for the Story Worlds analysis pipeline. Functions
 * are registered in `src/jobs/analyze-book.ts` and served from
 * `src/app/api/inngest/route.ts`.
 */
export const inngest = new Inngest({ id: "storyworlds" });

export interface BookAnalyzeRequestedEvent {
  name: "book/analyze.requested";
  data: {
    bookId: string;
    jobId: string;
  };
}

export interface OverlayPrefetchRequestedEvent {
  name: "overlay/prefetch.requested";
  data: {
    bookId: string;
    fromIdx: number;
    count: number;
  };
}

/**
 * Manual trigger for the always-on analysis sweeper (src/jobs/sweep-
 * analysis.ts) — the cron tick is what normally drives it; this lets an
 * admin action (or a test) force an immediate tick.
 */
export interface AnalysisSweepRequestedEvent {
  name: "analysis/sweep.requested";
  data: Record<string, never>;
}

/**
 * Manual trigger for the always-on illustration sweeper (src/jobs/sweep-
 * overlays.ts) — see AnalysisSweepRequestedEvent above.
 */
export interface OverlaySweepRequestedEvent {
  name: "overlay/sweep.requested";
  data: Record<string, never>;
}

/**
 * Manual trigger for the always-on cover-illustration backfill sweeper
 * (src/jobs/sweep-covers.ts) — see AnalysisSweepRequestedEvent above.
 */
export interface CoverSweepRequestedEvent {
  name: "cover/sweep.requested";
  data: Record<string, never>;
}
