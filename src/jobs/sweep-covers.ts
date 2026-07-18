import { and, eq, isNull } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, jobs, worldReferences } from "@/db/schema";
import { generateCoverForBook } from "@/services/cover";
import { isReaderActive } from "@/services/queue";
import { canSpend } from "@/services/quota";
import { classifyPriorityTier, sortByPriority } from "./priority";
import { inngest } from "./client";

/**
 * Always-on cover-illustration backfill. Covers today are only generated
 * once, best-effort, right after synthesis (see analyze-book.ts's
 * persistWorld) — if that attempt fails (image pipeline hiccup, or the book
 * was analyzed before cover generation shipped), it's never retried on its
 * own. This sweep drains that backlog over time: each tick generates ONE
 * cover for ONE fully-analyzed book that still has none, then stops — the
 * next tick resumes wherever it left off, derived fresh from the DB every
 * time (no in-memory cursor, so it survives restarts/redeploys for free).
 *
 * Mirrors src/jobs/sweep-overlays.ts's shape: pace against free-tier
 * headroom, stay mutually exclusive with a running full analysis (which
 * already spends the ≤3-concurrent-Gemini-call budget on its own), and
 * prioritize catalog/published books (shared across every reader) before
 * private ones — see src/jobs/priority.ts.
 */

const COVER_SWEEP_CRON = "TZ=UTC */5 * * * *";

export type SweepCoversResult =
  | { skipped: "quota_exhausted" }
  | { skipped: "readers_active" }
  | { skipped: "analysis_running" }
  | { skipped: "none_eligible" }
  | { bookId: string; generated: boolean };

interface CoverCandidate {
  bookId: string;
  createdAt: Date;
  catalogSource: string | null;
  visibility: string | null;
  pricingTier: string | null;
}

/**
 * Every fully-analyzed book that still has no cover — one join, no per-book
 * fan-out, regardless of corpus size.
 */
async function loadCoverCandidates(): Promise<CoverCandidate[]> {
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
    .where(isNull(books.coverStorageKey));
}

/**
 * One sweep tick. Skips while a full analyze_book run is actively in
 * progress, for the same reason sweep-overlays.ts does: analysis alone
 * already uses 3 concurrent LLM calls, so the sweepers stay mutually
 * exclusive in time to keep total concurrent Gemini calls at or under 3
 * system-wide (see CLAUDE.md ZERO-COST CONSTRAINT).
 */
async function sweepCoversOnce(): Promise<SweepCoversResult> {
  await dbReady;

  if (!(await canSpend("background"))) {
    console.log("[sweep-covers] skipping tick — background quota exhausted");
    return { skipped: "quota_exhausted" };
  }

  // Yield to active readers so interactive chat / on-read illustrations own
  // the per-minute rate limit (see isReaderActive).
  if (await isReaderActive()) {
    return { skipped: "readers_active" };
  }

  const [runningAnalysis] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, "analyze_book"), eq(jobs.status, "running")))
    .limit(1);
  if (runningAnalysis) {
    return { skipped: "analysis_running" };
  }

  const candidates = await loadCoverCandidates();
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
    const storageKey = await generateCoverForBook(bookId);
    return { bookId, generated: Boolean(storageKey) };
  } catch (err) {
    // generateCoverForBook already catches internally and returns null —
    // this is defense in depth so a truly unexpected throw still leaves the
    // sweep function itself resolved (Inngest will just retry the step).
    console.error(
      `[sweep-covers] cover generation failed for book ${bookId}:`,
      err,
    );
    return { bookId, generated: false };
  }
}

export const sweepCovers = inngest.createFunction(
  {
    id: "sweep-covers",
    concurrency: 1,
    triggers: [{ cron: COVER_SWEEP_CRON }, { event: "cover/sweep.requested" }],
  },
  async ({ step }) => {
    const result = await step.run("sweep-once", () => sweepCoversOnce());
    console.log("[sweep-covers]", result);
    return result;
  },
);
