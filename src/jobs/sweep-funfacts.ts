import { and, eq, isNull } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, jobs, worldReferences } from "@/db/schema";
import { generateFunFactsForBook } from "@/services/funfacts";
import { isReaderActive } from "@/services/queue";
import { canSpend } from "@/services/quota";
import { classifyPriorityTier, sortByPriority } from "./priority";
import { inngest } from "./client";

/**
 * Always-on "fun facts" backfill. Facts today are only generated once,
 * best-effort, right after synthesis (see analyze-book.ts's persistWorld) —
 * if that attempt fails (rate limit, DB hiccup, or the book was analyzed
 * before fun facts shipped), it's never retried on its own. This sweep
 * drains that backlog over time: each tick generates facts for ONE
 * fully-analyzed book that still has none, then stops — the next tick
 * resumes wherever it left off, derived fresh from the DB every time (no
 * in-memory cursor, so it survives restarts/redeploys for free).
 *
 * Mirrors src/jobs/sweep-covers.ts's shape exactly: pace against free-tier
 * headroom, stay mutually exclusive with a running full analysis (which
 * already spends the ≤3-concurrent-Gemini-call budget on its own), and
 * prioritize catalog/published books (shared across every reader) before
 * private ones — see src/jobs/priority.ts.
 */

const FUNFACTS_SWEEP_CRON = "TZ=UTC */5 * * * *";

export type SweepFunFactsResult =
  | { skipped: "quota_exhausted" }
  | { skipped: "readers_active" }
  | { skipped: "analysis_running" }
  | { skipped: "none_eligible" }
  | { bookId: string; generated: boolean };

interface FunFactsCandidate {
  bookId: string;
  createdAt: Date;
  catalogSource: string | null;
  visibility: string | null;
  pricingTier: string | null;
}

/**
 * Every fully-analyzed book that still has no fun facts — one join, no
 * per-book fan-out, regardless of corpus size.
 */
async function loadFunFactsCandidates(): Promise<FunFactsCandidate[]> {
  await dbReady;

  return db
    .select({
      bookId: books.id,
      createdAt: books.createdAt,
      catalogSource: books.catalogSource,
      visibility: books.visibility,
      pricingTier: books.pricingTier,
    })
    .from(books)
    .innerJoin(
      worldReferences,
      and(
        eq(worldReferences.bookId, books.id),
        eq(worldReferences.status, "completed"),
      ),
    )
    .where(isNull(books.funFacts));
}

/**
 * One sweep tick. Skips while a full analyze_book run is actively in
 * progress, for the same reason sweep-covers.ts does: analysis alone
 * already uses 3 concurrent LLM calls, so the sweepers stay mutually
 * exclusive in time to keep total concurrent Gemini calls at or under 3
 * system-wide (see CLAUDE.md ZERO-COST CONSTRAINT).
 */
async function sweepFunFactsOnce(): Promise<SweepFunFactsResult> {
  await dbReady;

  if (await isReaderActive()) {
    return { skipped: "readers_active" };
  }

  if (!(await canSpend("background"))) {
    console.log("[sweep-funfacts] skipping tick — background quota exhausted");
    return { skipped: "quota_exhausted" };
  }

  const [runningAnalysis] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, "analyze_book"), eq(jobs.status, "running")))
    .limit(1);
  if (runningAnalysis) {
    return { skipped: "analysis_running" };
  }

  const candidates = await loadFunFactsCandidates();
  if (candidates.length === 0) {
    return { skipped: "none_eligible" };
  }

  const prioritized = sortByPriority(
    candidates.map((b) => ({
      bookId: b.bookId,
      tier: classifyPriorityTier(b),
      createdAt: b.createdAt,
    })),
  );
  const bookId = prioritized[0].bookId;

  try {
    const facts = await generateFunFactsForBook(bookId);
    return { bookId, generated: Boolean(facts) };
  } catch (err) {
    // generateFunFactsForBook already catches internally and returns null —
    // this is defense in depth so a truly unexpected throw still leaves the
    // sweep function itself resolved (Inngest will just retry the step).
    console.error(
      `[sweep-funfacts] fun-facts generation failed for book ${bookId}:`,
      err,
    );
    return { bookId, generated: false };
  }
}

export const sweepFunFacts = inngest.createFunction(
  {
    id: "sweep-funfacts",
    concurrency: 1,
    triggers: [
      { cron: FUNFACTS_SWEEP_CRON },
      { event: "funfacts/sweep.requested" },
    ],
  },
  async ({ step }) => {
    const result = await step.run("sweep-once", () => sweepFunFactsOnce());
    console.log("[sweep-funfacts]", result);
    return result;
  },
);
