import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { handleApiError } from "@/lib/errors";

// TEMPORARY: probe whether this key can generate images on the free tier, per
// candidate image model. Any signed-in user (model/result only, no secrets).
const CANDIDATES = ["gemini-3.1-flash-image", "gemini-3-pro-image", "nano-banana-pro-preview"];

export async function GET() {
  try {
    await requireUser();
    const key = env.GOOGLE_API_KEY;
    if (!key) return NextResponse.json({ error: "no key" });
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: key });
    const results: Record<string, string> = {};
    for (const model of CANDIDATES) {
      try {
        const r = await client.models.generateContent({
          model,
          contents: "A moody engraving of a Victorian castle at dusk.",
          config: { responseModalities: ["IMAGE", "TEXT"] },
        });
        const parts = r.candidates?.[0]?.content?.parts ?? [];
        const img = parts.find((p) => p.inlineData?.data);
        results[model] = img
          ? `OK image ${img.inlineData?.mimeType} ${(img.inlineData?.data?.length ?? 0)} b64chars`
          : "no inlineData part";
      } catch (e) {
        results[model] = `ERR: ${(e as Error).message.slice(0, 90)}`;
      }
    }
    return NextResponse.json({ results });
  } catch (e) {
    return handleApiError(e);
  }
}
