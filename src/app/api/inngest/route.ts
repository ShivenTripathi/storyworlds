import { serve } from "inngest/next";
import { analyzeBook } from "@/jobs/analyze-book";
// SECURITY (audit C1): without a signing key, serve() can't verify request
// signatures and this endpoint would accept UNAUTHENTICATED job triggers for
// any bookId (destructive + burns the shared free-tier quota). The key is set
// in prod; this loud warning catches a future misconfiguration in real
// deployments (VERCEL_ENV set) without breaking local `next build`
// (NODE_ENV=production but no key, by design).
if (
  process.env.VERCEL_ENV &&
  process.env.VERCEL_ENV !== "development" &&
  !process.env.INNGEST_SIGNING_KEY
) {
  console.error(
    "[SECURITY] INNGEST_SIGNING_KEY is unset in a deployed environment — /api/inngest would accept unauthenticated job triggers. Set it immediately.",
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
