import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { books, users } from "@/db/schema";
import { ApiError } from "@/lib/errors";

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

  const email =
    (sessionClaims?.email as string | undefined) ??
    (sessionClaims as { email_address?: string } | null)?.email_address ??
    null;

  await db.insert(users).values({ id: userId, email }).onConflictDoNothing();

  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return { userId, role: row?.role ?? "reader" };
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
