import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { MAX_CHUNKS } from "@/domain/book-format";
import { requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import {
  createBookFromExtracted,
  createBookFromUpload,
  detectBookFormat,
  listBooks,
  toBookDto,
  type PricingTier,
} from "@/services/books";
import { checkEntitlement } from "@/services/entitlements";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// Zip-bomb guard for the gzipped upload path — a hair above the largest
// legitimate extracted payload (MAX_CHUNKS × MAX_PAGE_CHARS ≈ 160MB).
const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024;

const metaSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  author: z.string().trim().min(1).max(300).optional(),
  // 'private' (default): premium, single-reader analysis, never shared.
  // 'published': a contribution to the public library — REQUIRES
  // rightsAttestation below. See CLAUDE.md "THE MODEL".
  visibility: z.enum(["private", "published"]).optional(),
  rightsAttestation: z.enum(["public_domain", "owned_contributed"]).optional(),
});

// The primary upload path: the browser extracts the file to page-sized text
// (src/components/shelf/extract-book.ts) and posts it as JSON. This keeps the
// request body a fraction of the source size, sidestepping Vercel's 4.5MB
// serverless body limit that made large PDFs fail.
const extractedSchema = metaSchema.extend({
  sourceFormat: z.enum(["pdf", "epub", "txt"]),
  pages: z
    .array(
      z.object({
        pageNum: z.number().int().nonnegative(),
        text: z.string(),
      }),
    )
    .min(1)
    .max(MAX_CHUNKS),
});

/**
 * Resolves + enforces the shared publish/visibility policy for both upload
 * paths: publishing to the public library REQUIRES a rights attestation (the
 * waiver that lets one analysis be shared across every reader — see CLAUDE.md
 * "THE MODEL"), and this is the one place that invariant is enforced
 * server-side. Also runs the entitlement/quota check (which protects the
 * Gemini free-tier daily budget — every upload kicks off analysis LLM calls).
 */
async function resolveUploadPolicy(
  userId: string,
  visibility: "private" | "published",
  rightsAttestation: "public_domain" | "owned_contributed" | undefined,
): Promise<{ pricingTier: PricingTier }> {
  if (visibility === "published" && !rightsAttestation) {
    throw new ApiError(
      400,
      "attestation_required",
      "Contributing to the public library requires a rights attestation — confirm the work is public domain, or that you own it and waive exclusive rights.",
    );
  }
  const pricingTier: PricingTier =
    visibility === "published" ? "public_subsidized" : "private_premium";
  await checkEntitlement(userId, "upload", { pricingTier });
  return { pricingTier };
}

export async function POST(req: NextRequest) {
  try {
    await dbReady;
    const { userId } = await requireUser();

    rateLimit(`user:${userId}:upload`, { windowSeconds: 600, max: 5 });

    const contentType = req.headers.get("content-type") ?? "";

    // --- Primary path: client-extracted text posted as JSON -----------------
    // Sent either as plain application/json, or (for large books) gzipped and
    // sent as application/octet-stream — the compressed body is a fraction of
    // the size, keeping even a long novel comfortably under Vercel's 4.5MB
    // serverless request-body limit.
    const isGzipped = contentType.includes("application/octet-stream");
    if (contentType.includes("application/json") || isGzipped) {
      let payload: unknown;
      try {
        payload = isGzipped
          ? JSON.parse(
              // Cap decompression: the largest legitimate payload is
              // MAX_CHUNKS * MAX_PAGE_CHARS (~160MB); a tight ceiling above
              // that makes gunzipSync throw RangeError on a zip bomb (a tiny
              // gzip inflating to gigabytes) instead of OOM-killing the
              // single-instance serverless function.
              gunzipSync(Buffer.from(await req.arrayBuffer()), {
                maxOutputLength: MAX_DECOMPRESSED_BYTES,
              }).toString("utf-8"),
            )
          : await req.json();
      } catch {
        throw new ApiError(
          400,
          "invalid_request",
          "Malformed upload payload — the file may not have extracted cleanly. Try again.",
        );
      }

      const parsed = extractedSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ApiError(
          400,
          "invalid_request",
          "Malformed upload payload — the file may not have extracted cleanly. Try again.",
        );
      }

      const visibility = parsed.data.visibility ?? "private";
      const { pricingTier } = await resolveUploadPolicy(
        userId,
        visibility,
        parsed.data.rightsAttestation,
      );

      const book = await createBookFromExtracted({
        ownerId: userId,
        sourceFormat: parsed.data.sourceFormat,
        title: parsed.data.title ?? null,
        author: parsed.data.author ?? null,
        pages: parsed.data.pages,
        visibility,
        pricingTier,
        rightsAttestation: parsed.data.rightsAttestation ?? null,
        contributedByUserId: visibility === "published" ? userId : null,
      });

      return NextResponse.json(
        { book: await toBookDto(book) },
        { status: 201 },
      );
    }

    // --- Legacy path: raw file as multipart (small files / API callers) -----
    // Subject to Vercel's 4.5MB serverless body limit — the browser uses the
    // JSON path above for anything larger.
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "invalid_request", "Missing 'file' field.");
    }
    if (file.size === 0) {
      throw new ApiError(400, "invalid_request", "File is empty.");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ApiError(400, "invalid_request", "File exceeds 50MB limit.");
    }

    const buffer = new Uint8Array(await file.arrayBuffer());

    // Format is resolved from the extension + verified against the file's
    // actual magic bytes/content — never the client-supplied MIME type alone.
    if (!detectBookFormat(file.name, buffer)) {
      throw new ApiError(
        400,
        "invalid_request",
        "Unsupported or unrecognized file — upload a PDF, EPUB, or plain-text (.txt) file.",
      );
    }

    const parsed = metaSchema.safeParse({
      title: form.get("title") ?? undefined,
      author: form.get("author") ?? undefined,
      visibility: form.get("visibility") ?? undefined,
      rightsAttestation: form.get("rightsAttestation") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        "Invalid title/author/visibility.",
      );
    }

    const visibility = parsed.data.visibility ?? "private";
    const { pricingTier } = await resolveUploadPolicy(
      userId,
      visibility,
      parsed.data.rightsAttestation,
    );

    const book = await createBookFromUpload({
      ownerId: userId,
      filename: file.name,
      data: buffer,
      title: parsed.data.title ?? null,
      author: parsed.data.author ?? null,
      visibility,
      pricingTier,
      rightsAttestation: parsed.data.rightsAttestation ?? null,
      contributedByUserId: visibility === "published" ? userId : null,
    });

    return NextResponse.json({ book: await toBookDto(book) }, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function GET() {
  try {
    await dbReady;
    const { userId } = await requireUser();

    const rows = await listBooks(userId);
    const books = await Promise.all(
      rows.map((r) => toBookDto(r.book, r, r.source)),
    );

    return NextResponse.json({ books });
  } catch (e) {
    return handleApiError(e);
  }
}
