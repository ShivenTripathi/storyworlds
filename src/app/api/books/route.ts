import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { createBookFromPdf, listBooks, toBookDto } from "@/services/books";
import { checkEntitlement } from "@/services/entitlements";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

const metaSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  author: z.string().trim().min(1).max(300).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await dbReady;
    const { userId } = await requireUser();

    rateLimit(`user:${userId}:upload`, { windowSeconds: 600, max: 5 });
    // Also protects the Gemini free-tier daily quota — every upload kicks
    // off the analysis pipeline's LLM calls (see ZERO-COST CONSTRAINT).
    await checkEntitlement(userId, "upload");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "invalid_request", "Missing 'file' field.");
    }
    if (file.type && file.type !== "application/pdf") {
      throw new ApiError(400, "invalid_request", "File must be a PDF.");
    }
    if (file.size === 0) {
      throw new ApiError(400, "invalid_request", "File is empty.");
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new ApiError(400, "invalid_request", "File exceeds 50MB limit.");
    }

    const parsed = metaSchema.safeParse({
      title: form.get("title") ?? undefined,
      author: form.get("author") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "Invalid title/author.");
    }

    const defaultTitle = file.name.replace(/\.pdf$/i, "");
    const title = parsed.data.title ?? defaultTitle ?? "Untitled";
    const author = parsed.data.author ?? null;

    const buffer = new Uint8Array(await file.arrayBuffer());

    const book = await createBookFromPdf({
      ownerId: userId,
      title,
      author,
      data: buffer,
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
