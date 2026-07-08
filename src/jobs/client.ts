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
