import { serve } from "inngest/next";
import { analyzeBook } from "@/jobs/analyze-book";
import { catalogIngest } from "@/jobs/catalog-ingest";
import { inngest } from "@/jobs/client";
import { generateOverlayPrefetch } from "@/jobs/generate-overlay";
import { sweepAnalysis } from "@/jobs/sweep-analysis";
import { sweepCovers } from "@/jobs/sweep-covers";
import { sweepOverlays } from "@/jobs/sweep-overlays";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    analyzeBook,
    generateOverlayPrefetch,
    catalogIngest,
    sweepAnalysis,
    sweepOverlays,
    sweepCovers,
  ],
});
