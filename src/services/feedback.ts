import { and, desc, eq, sql } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { feedback, users } from "@/db/schema";

export type FeedbackKind = "praise" | "idea" | "bug" | "general";
export type FeedbackSentiment = "up" | "down";
export type FeedbackStatus = "new" | "triaged" | "resolved";

/**
 * Auto-captured tracing about what the reader was doing — never asked for,
 * just observed by the widget on open. `bookId` is populated when the
 * pathname matches a /books/[id]* route.
 */
export interface FeedbackContext {
  bookId?: string;
  viewport?: { width: number; height: number };
  userAgent?: string;
  referrer?: string;
  appVersion?: string;
  [key: string]: unknown;
}

export interface SubmitFeedbackInput {
  userId: string;
  kind: FeedbackKind;
  sentiment?: FeedbackSentiment | null;
  rating?: number | null;
  message: string;
  pathname?: string | null;
  context?: FeedbackContext | null;
}

export interface FeedbackRow {
  id: string;
  userId: string;
  userEmail: string | null;
  kind: FeedbackKind;
  sentiment: FeedbackSentiment | null;
  rating: number | null;
  message: string;
  pathname: string | null;
  context: FeedbackContext | null;
  status: FeedbackStatus;
  adminNote: string | null;
  createdAt: Date;
}

export interface ListFeedbackParams {
  status?: FeedbackStatus;
  kind?: FeedbackKind;
  limit?: number;
}

export interface FeedbackCounts {
  byKind: Record<FeedbackKind, number>;
  bySentiment: { up: number; down: number; none: number };
}

export interface ListFeedbackResult {
  items: FeedbackRow[];
  counts: FeedbackCounts;
}

const DEFAULT_LIMIT = 100;
const EMPTY_KIND_COUNTS: Record<FeedbackKind, number> = {
  praise: 0,
  idea: 0,
  bug: 0,
  general: 0,
};

type FeedbackSelectRow = typeof feedback.$inferSelect;

function toFeedbackRow(
  row: FeedbackSelectRow,
  userEmail: string | null,
): FeedbackRow {
  return {
    id: row.id,
    userId: row.userId,
    userEmail,
    kind: row.kind as FeedbackKind,
    sentiment: (row.sentiment as FeedbackSentiment | null) ?? null,
    rating: row.rating ?? null,
    message: row.message,
    pathname: row.pathname ?? null,
    context: (row.context as FeedbackContext | null) ?? null,
    status: (row.status as FeedbackStatus) ?? "new",
    adminNote: row.adminNote ?? null,
    createdAt: row.createdAt,
  };
}

async function emailFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.email ?? null;
}

/**
 * Inserts a feedback row. No auth logic here — the caller (the API route)
 * already resolved `userId` via requireUser(); this is a thin persistence
 * layer only.
 */
export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<FeedbackRow> {
  await dbReady;

  const [row] = await db
    .insert(feedback)
    .values({
      userId: input.userId,
      kind: input.kind,
      sentiment: input.sentiment ?? null,
      rating: input.rating ?? null,
      message: input.message,
      pathname: input.pathname ?? null,
      context: input.context ?? null,
    })
    .returning();

  return toFeedbackRow(row, await emailFor(input.userId));
}

/**
 * Newest-first feedback rows joined with the submitter's email, plus
 * aggregate counts by kind and by sentiment computed across the FULL table
 * (not just the filtered page) so the admin summary strip always reflects
 * the whole feedback set.
 */
export async function listFeedback(
  params: ListFeedbackParams = {},
): Promise<ListFeedbackResult> {
  await dbReady;

  const conditions = [];
  if (params.status) conditions.push(eq(feedback.status, params.status));
  if (params.kind) conditions.push(eq(feedback.kind, params.kind));

  const rows = await db
    .select({
      id: feedback.id,
      userId: feedback.userId,
      userEmail: users.email,
      kind: feedback.kind,
      sentiment: feedback.sentiment,
      rating: feedback.rating,
      message: feedback.message,
      pathname: feedback.pathname,
      context: feedback.context,
      status: feedback.status,
      adminNote: feedback.adminNote,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .leftJoin(users, eq(users.id, feedback.userId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(feedback.createdAt))
    .limit(params.limit ?? DEFAULT_LIMIT);

  const items: FeedbackRow[] = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userEmail: r.userEmail ?? null,
    kind: r.kind as FeedbackKind,
    sentiment: (r.sentiment as FeedbackSentiment | null) ?? null,
    rating: r.rating ?? null,
    message: r.message,
    pathname: r.pathname ?? null,
    context: (r.context as FeedbackContext | null) ?? null,
    status: (r.status as FeedbackStatus) ?? "new",
    adminNote: r.adminNote ?? null,
    createdAt: r.createdAt,
  }));

  const kindCounts = await db
    .select({ kind: feedback.kind, count: sql<number>`count(*)::int` })
    .from(feedback)
    .groupBy(feedback.kind);

  const sentimentCounts = await db
    .select({
      sentiment: feedback.sentiment,
      count: sql<number>`count(*)::int`,
    })
    .from(feedback)
    .groupBy(feedback.sentiment);

  const byKind: Record<FeedbackKind, number> = { ...EMPTY_KIND_COUNTS };
  for (const row of kindCounts) {
    if (row.kind in byKind) byKind[row.kind as FeedbackKind] = row.count;
  }

  const bySentiment = { up: 0, down: 0, none: 0 };
  for (const row of sentimentCounts) {
    if (row.sentiment === "up") bySentiment.up = row.count;
    else if (row.sentiment === "down") bySentiment.down = row.count;
    else bySentiment.none += row.count;
  }

  return { items, counts: { byKind, bySentiment } };
}

/**
 * Patches status and/or admin note on a feedback row. Returns null if the
 * row doesn't exist (the route maps that to a 404).
 */
export async function updateFeedbackStatus(
  id: string,
  updates: { status?: FeedbackStatus; adminNote?: string | null },
): Promise<FeedbackRow | null> {
  await dbReady;

  const patch: Partial<FeedbackSelectRow> = {};
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.adminNote !== undefined) patch.adminNote = updates.adminNote;

  if (Object.keys(patch).length === 0) {
    const [existing] = await db
      .select()
      .from(feedback)
      .where(eq(feedback.id, id))
      .limit(1);
    if (!existing) return null;
    return toFeedbackRow(existing, await emailFor(existing.userId));
  }

  const [row] = await db
    .update(feedback)
    .set(patch)
    .where(eq(feedback.id, id))
    .returning();

  if (!row) return null;
  return toFeedbackRow(row, await emailFor(row.userId));
}
