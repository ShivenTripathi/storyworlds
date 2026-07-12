import { and, eq, inArray } from "drizzle-orm";
import { CATALOG_SEED } from "@/catalog/gutenberg";
import { db, dbReady } from "@/db";
import { books, jobs, users } from "@/db/schema";
import { inngest } from "@/jobs/client";
import { createBookFromText } from "@/services/books";
import { fetchGutenbergText } from "@/services/gutenberg";

/** Fixed sentinel owner for auto-ingested catalog books. */
export const CATALOG_USER_ID = "system:catalog";

/** Upserts the sentinel catalog user row. Idempotent. Returns its id. */
export async function ensureCatalogUser(): Promise<string> {
  await dbReady;
  await db
    .insert(users)
    .values({ id: CATALOG_USER_ID, email: null, role: "reader" })
    .onConflictDoNothing({ target: users.id });
  return CATALOG_USER_ID;
}

export type IngestResult =
  | { skipped: "busy" }
  | { done: true }
  | { ingested: string }
  | { error: string };

/**
 * Ingests the next not-yet-ingested catalog title, one book per tick to
 * respect the Gemini free-tier rate limit (see ZERO-COST CONSTRAINT in
 * CLAUDE.md). Paces itself off the analyze_book job queue: if any analysis
 * job is queued/running, this call is a no-op so the pipeline never piles up
 * concurrent analysis runs against a shared free-tier quota.
 */
export async function ingestNextCatalogBook(): Promise<IngestResult> {
  await dbReady;

  const [busyJob] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, "analyze_book"),
        inArray(jobs.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (busyJob) {
    return { skipped: "busy" };
  }

  const existingSources = new Set(
    (
      await db
        .select({ catalogSource: books.catalogSource })
        .from(books)
        .where(
          inArray(
            books.catalogSource,
            CATALOG_SEED.map((s) => `gutenberg:${s.gutenbergId}`),
          ),
        )
    )
      .map((r) => r.catalogSource)
      .filter((s): s is string => s !== null),
  );

  const next = CATALOG_SEED.find(
    (s) => !existingSources.has(`gutenberg:${s.gutenbergId}`),
  );
  if (!next) {
    return { done: true };
  }

  const catalogSource = `gutenberg:${next.gutenbergId}`;

  try {
    const ownerId = await ensureCatalogUser();
    const text = await fetchGutenbergText(next.gutenbergId);

    const book = await createBookFromText({
      ownerId,
      title: next.title,
      author: next.author,
      text,
      catalogSource,
      blurb: next.blurb,
      archetype: next.archetype,
      visibility: "published",
    });

    const [job] = await db
      .insert(jobs)
      .values({
        bookId: book.id,
        userId: ownerId,
        kind: "analyze_book",
        status: "queued",
        progress: 0,
        stage: "Queued…",
      })
      .returning();

    await inngest.send({
      name: "book/analyze.requested",
      data: { bookId: book.id, jobId: job.id },
    });

    return { ingested: next.title };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[catalog] ingest failed for ${catalogSource}:`, err);
    return { error: message };
  }
}
