import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { storedFiles } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";

type Params = { params: Promise<{ key: string[] }> };

/**
 * Serves blobs stored via the DB-backed storage driver
 * (src/services/storage.ts DbStorageDriver). Book assets, not public —
 * requires a signed-in user. Keys are effectively immutable once written, so
 * responses are cached hard.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    await requireUser();
    await dbReady;

    const { key: segments } = await params;
    const key = segments.join("/");

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
