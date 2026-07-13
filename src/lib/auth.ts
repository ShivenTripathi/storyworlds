import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, jobs, users } from "@/db/schema";
import { ApiError } from "@/lib/errors";
import { env } from "@/lib/env";

function adminEmails(): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export type CurrentUser = {
  userId: string;
  role: string;
};

/**
 * Resolves the authenticated Clerk user for the current request, ensuring a
 * corresponding `users` row exists (upserted on first sight). Throws a 401
 * ApiError when there is no signed-in user.
 */
export async function requireUser(): Promise<CurrentUser> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    throw new ApiError(401, "unauthorized", "Sign in required.");
  }

  await dbReady;

  const claimEmail =
    (sessionClaims?.email as string | undefined) ??
    (sessionClaims as { email_address?: string } | null)?.email_address ??
    null;

  await db
    .insert(users)
    .values({ id: userId, email: claimEmail })
    .onConflictDoNothing();

  const [row] = await db
    .select({ role: users.role, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  let email = row?.email ?? claimEmail;

  // Clerk's default session token carries no email claim, so backfill it
  // once from the Clerk backend the first time we see a row without one.
  if (!email) {
    try {
      const client = await clerkClient();
      const cu = await client.users.getUser(userId);
      email = cu.primaryEmailAddress?.emailAddress ?? null;
      if (email) {
        await db.update(users).set({ email }).where(eq(users.id, userId));
      }
    } catch {
      // Non-fatal: email stays null; admin bootstrap simply won't match.
    }
  }

  let role = row?.role ?? "reader";

  // Admin bootstrap: promote configured emails to 'admin' idempotently.
  // Replaces the legacy pattern of hardcoding an email in an `if` check —
  // the role lives in the DB and this just keeps it in sync with env config.
  if (email && role !== "admin" && adminEmails().has(email.toLowerCase())) {
    await db.update(users).set({ role: "admin" }).where(eq(users.id, userId));
    role = "admin";
  }

  return { userId, role };
}

/**
 * Loads a book and enforces access:
 *  - owner: always
 *  - admin (users.role === 'admin'): always
 *  - anyone else, read-only: only if the book is published
 * Throws 404 if the book doesn't exist, 403 if access is denied.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireBookAccess(
  bookId: string,
  userId: string,
  { write = false }: { write?: boolean } = {},
) {
  // Invalid UUIDs would throw a Postgres cast error (500); treat them as 404.
  if (!UUID_RE.test(bookId)) {
    throw new ApiError(404, "not_found", "Book not found.");
  }

  await dbReady;

  const [book] = await db
    .select()
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);

  if (!book) {
    throw new ApiError(404, "not_found", "Book not found.");
  }

  if (book.ownerId === userId) {
    return book;
  }

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.role === "admin") {
    return book;
  }

  if (!write && book.visibility === "published") {
    return book;
  }

  throw new ApiError(403, "forbidden", "You don't have access to this book.");
}

/**
 * Loads a job and enforces access: owner or admin only — jobs have no
 * 'published' concept, so unlike requireBookAccess there is no read-only
 * public path. Returns 404 (not 403) for both "doesn't exist" and "exists
 * but isn't yours", so a job ID can't be used to probe for existence.
 */
export async function requireJobAccess(jobId: string, userId: string) {
  if (!UUID_RE.test(jobId)) {
    throw new ApiError(404, "not_found", "Job not found.");
  }

  await dbReady;

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) {
    throw new ApiError(404, "not_found", "Job not found.");
  }

  if (job.userId === userId) {
    return job;
  }

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.role !== "admin") {
    throw new ApiError(404, "not_found", "Job not found.");
  }

  return job;
}
