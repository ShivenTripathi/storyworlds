import { NextResponse } from "next/server";
import { z } from "zod";
import { dbReady } from "@/db";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { requireUser } from "@/lib/auth";
import { ApiError, handleApiError } from "@/lib/errors";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

/** Lists the caller's API keys (never the secret itself, only metadata). */
export async function GET() {
  try {
    await dbReady;
    const { userId } = await requireUser();
    const keys = await listApiKeys(userId);
    return NextResponse.json({ keys });
  } catch (e) {
    return handleApiError(e);
  }
}

/** Mints a new API key; the full secret is only ever returned in this response. */
export async function POST(req: Request) {
  try {
    await dbReady;
    const { userId } = await requireUser();

    const json = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "Invalid body: expected { name? }.");
    }

    const created = await createApiKey(userId, parsed.data.name);
    return NextResponse.json({ apiKey: created }, { status: 201 });
  } catch (e) {
    return handleApiError(e);
  }
}
