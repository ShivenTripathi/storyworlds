import { createHash } from "node:crypto";
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

// Derived from the key + byte size rather than hashing the (potentially
// large) blob body on every request — cheap to compute, and stable for as
// long as the row is (storage.ts only ever replaces a key's bytes wholesale,
// never appends/patches, so key+size changing is exactly the case where the
// old ETag should stop matching).
function etagFor(key: string, size: number): string {
  const digest = createHash("sha1").update(`${key}:${size}`).digest("hex");
  return `"${digest}"`;
}

function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === etag || tag === `W/${etag}`);
}

/**
 * Serves blobs stored via the DB-backed storage driver
 * (src/services/storage.ts DbStorageDriver). Book assets, gated by book
 * access. Keys are effectively immutable once written, so responses cache
 * hard and honor If-None-Match with a 304 to avoid re-sending unchanged
 * bytes on every reader page-turn/scroll.
 */
export async function GET(req: Request, { params }: Params) {
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
      .select({
        data: storedFiles.data,
        contentType: storedFiles.contentType,
        size: storedFiles.size,
      })
      .from(storedFiles)
      .where(eq(storedFiles.key, key))
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { error: { code: "not_found", message: "File not found." } },
        { status: 404 },
      );
    }

    const size = row.size ?? row.data.length;
    const etag = etagFor(key, size);
    // Access is auth-gated per book, so this must stay `private` — a shared
    // cache must never serve one reader's book asset to another.
    const cacheControl = "private, max-age=86400, immutable";

    if (ifNoneMatchHits(req.headers.get("if-none-match"), etag)) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": cacheControl },
      });
    }

    return new NextResponse(new Uint8Array(row.data), {
      status: 200,
      headers: {
        "Content-Type": row.contentType ?? "application/octet-stream",
        "Cache-Control": cacheControl,
        ETag: etag,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
