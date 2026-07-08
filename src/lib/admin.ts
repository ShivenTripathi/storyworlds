import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";

/**
 * Like `requireUser`, but also enforces `role === 'admin'`. Used by every
 * `/api/admin/*` route. Throws 401 if unauthenticated, 403 if signed in but
 * not an admin.
 */
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new ApiError(403, "forbidden", "Admin access required.");
  }
  return user;
}
