import { ingestNextCatalogBook } from "@/services/catalog";
import { inngest } from "./client";

/**
 * Self-draining catalog ingestion: every 10 minutes, pull the next
 * not-yet-ingested title from CATALOG_SEED and kick off its analysis job.
 * One book at a time (paced off the analyze_book job queue in
 * ingestNextCatalogBook) to stay well under the Gemini free-tier rate limit
 * — see ZERO-COST CONSTRAINT in CLAUDE.md. Can also be triggered immediately
 * via the `catalog/ingest.requested` event (see the admin trigger route).
 */
export const catalogIngest = inngest.createFunction(
  {
    id: "catalog-ingest",
    concurrency: 1,
    triggers: [
      { cron: "TZ=UTC */10 * * * *" },
      { event: "catalog/ingest.requested" },
    ],
  },
  async ({ step }) => {
    const result = await step.run("ingest-next", () => ingestNextCatalogBook());
    console.log("[catalog-ingest]", result);
    return result;
  },
);
