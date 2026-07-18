import { serve } from "inngest/next";
import { analyzeBook } from "@/jobs/analyze-book";
// SECURITY (audit C1): without a signing key, serve() can't verify request
// signatures and this endpoint would accept UNAUTHENTICATED job triggers for
// any bookId (destructive + burns the shared free-tier quota). Fail closed in
// deployed environments (VERCEL_ENV set) — a misconfigured deploy is exactly
// when nobody is reading logs. Local `next build` is unaffected
// (NODE_ENV=production but no VERCEL_ENV, by design).
if (
  process.env.VERCEL_ENV &&
  process.env.VERCEL_ENV !== "development" &&
  !process.env.INNGEST_SIGNING_KEY
) {
  throw new Error(
    "[SECURITY] INNGEST_SIGNING_KEY is unset in a deployed environment — /api/inngest would accept unauthenticated job triggers. Set it before deploying.",
  );
}
import { catalogIngest } from "@/jobs/catalog-ingest";
import { inngest } from "@/jobs/client";
import { generateOverlayPrefetch } from "@/jobs/generate-overlay";
import { sweepAnalysis } from "@/jobs/sweep-analysis";
import { sweepCovers } from "@/jobs/sweep-covers";
import { sweepFunFacts } from "@/jobs/sweep-funfacts";
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
    sweepFunFacts,
  ],
});
