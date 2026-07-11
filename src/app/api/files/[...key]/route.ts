import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { storedFiles } from "@/db/schema";
import { requireUser, requireBookAccess } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";

type Params = { params: Promise<{ key: string[] }> };

// Every stored blob is a per-book asset keyed `books/<bookId>/...`
// (source.pdf, images/<idx>.img). Derive the owning book and enforce the
// same access check every other book-scoped route uses — otherwise any
// signed-in user could read another user's private files by key (IDOR).
const BOOK_KEY = /^books\/([0-9a-f-]{36})\//i;

/**
 * Serves blobs stored via the DB-backed storage driver
 * (src/services/storage.ts DbStorageDriver). Book assets, gated by book
 * access. Keys are effectively immutable once written, so responses cache hard.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { userId } = await requireUser();
    await dbReady;

    const { key: segments } = await params;
    const key = segments.join("/");

    const match = BOOK_KEY.exec(key);
    if (!match) {
      // Unknown key shape — never serve it. All current keys are book-scoped.
      throw new ApiError(404, "not_found", "File not found.");
    }
    await requireBookAccess(match[1], userId);

    const [row] = await db
      .select({ data: storedFiles.data, contentType: storedFiles.contentType })
      .from(storedFiles)
      .where(eq(storedFiles.key, key))
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { error: { code: "not_found", message: "File not found." } },
        { status: 404 },
      );
    }

    return new NextResponse(new Uint8Array(row.data), {
      status: 200,
      headers: {
        "Content-Type": row.contentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
