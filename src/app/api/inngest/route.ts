import { serve } from "inngest/next";
import { analyzeBook } from "@/jobs/analyze-book";
import { catalogIngest } from "@/jobs/catalog-ingest";
import { inngest } from "@/jobs/client";
import { generateOverlayPrefetch } from "@/jobs/generate-overlay";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [analyzeBook, generateOverlayPrefetch, catalogIngest],
});
