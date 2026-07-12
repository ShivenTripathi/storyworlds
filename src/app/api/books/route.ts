import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import {
  createBookFromUpload,
  detectBookFormat,
  listBooks,
  toBookDto,
} from "@/services/books";
import { checkEntitlement } from "@/services/entitlements";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const metaSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  author: z.string().trim().min(1).max(300).optional(),
  // 'private' (default): premium, single-reader analysis, never shared.
  // 'published': a contribution to the public library — REQUIRES
  // rightsAttestation below. See CLAUDE.md "THE MODEL".
  visibility: z.enum(["private", "published"]).optional(),
  rightsAttestation: z.enum(["public_domain", "owned_contributed"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await dbReady;
    const { userId } = await requireUser();

    rateLimit(`user:${userId}:upload`, { windowSeconds: 600, max: 5 });

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
    // actual magic bytes/content — never the client-supplied MIME type
    // alone (that's easy to spoof from a <input accept> bypass or a raw
    // multipart request). Fail fast, before any DB/entitlement work.
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

    // Publishing (contributing to the public library) REQUIRES a rights
    // attestation — the waiver that lets the analysis be shared across
    // every reader (see CLAUDE.md "THE MODEL"). Private uploads never need
    // one. This is the one place that invariant is enforced server-side;
    // never trust a client to only send 'published' when it also sent an
    // attestation.
    if (visibility === "published" && !parsed.data.rightsAttestation) {
      throw new ApiError(
        400,
        "attestation_required",
        "Contributing to the public library requires a rights attestation — confirm the work is public domain, or that you own it and waive exclusive rights.",
      );
    }

    const pricingTier =
      visibility === "published" ? "public_subsidized" : "private_premium";

    // Also protects the Gemini free-tier daily quota — every upload kicks
    // off the analysis pipeline's LLM calls (see ZERO-COST CONSTRAINT).
    // Public contributions check against a separate, much larger allowance
    // (subsidized — the cost is amortized across every reader) than
    // private/premium uploads (see src/services/entitlements.ts).
    await checkEntitlement(userId, "upload", { pricingTier });

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

    return NextResponse.json({ book: toBookDto(book) }, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function GET() {
  try {
    await dbReady;
    const { userId } = await requireUser();

    const rows = await listBooks(userId);
    const books = rows.map((r) => toBookDto(r.book, r, r.source));

    return NextResponse.json({ books });
  } catch (e) {
    return handleApiError(e);
  }
}
