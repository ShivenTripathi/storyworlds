import { db, dbReady } from "@/db";
import { usageEvents } from "@/db/schema";
import { env } from "@/lib/env";

/**
 * Pluggable scene-image generation, selected by env.MODEL_IMAGE. Images are
 * an enhancement, never a requirement (see ZERO-COST CONSTRAINT in
 * CLAUDE.md: no paid image generation in prod) — every path below degrades
 * to `null` on any error instead of throwing, so a flaky/unset image
 * provider never breaks overlay generation.
 *
 * Selection:
 *  - 'none' (default) -> always null.
 *  - 'pollinations'    -> free, keyless, experimental HTTP image endpoint.
 *  - 'gemini:<model>'  -> @google/genai image generation (paid-only API;
 *                         dormant unless a user explicitly opts in and
 *                         accepts the cost — never the zero-cost default).
 */

export interface GeneratedImage {
  data: Uint8Array;
  contentType: string;
  provider: string;
  model: string;
}

const warnedOnce = new Set<string>();
function warnOnce(key: string, message: string) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message);
}

async function recordImageUsage(opts: {
  bookId?: string;
  userId?: string;
  provider: string;
  model: string;
}) {
  try {
    await dbReady;
    await db.insert(usageEvents).values({
      bookId: opts.bookId ?? null,
      userId: opts.userId ?? null,
      provider: opts.provider,
      model: opts.model,
      operation: "image",
      inputTokens: 0,
      outputTokens: 0,
      // Cost is recorded as 0: the 'pollinations' driver is free/keyless,
      // and the 'gemini' image driver's per-image pricing isn't in
      // PRICE_TABLE (src/ai/client.ts) yet — surfacing a wrong number would
      // be worse than surfacing none. Revisit if/when a paid image driver
      // becomes part of the supported zero-cost-adjacent profile.
      costUsd: "0",
    });
  } catch (err) {
    console.error("[ai/image] failed to record usage event:", err);
  }
}

async function generateWithPollinations(prompt: string): Promise<GeneratedImage | null> {
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=640&nologo=true`;
    const res = await fetch(url, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      warnOnce(
        "pollinations",
        `[ai/image] pollinations request failed (status ${res.status}) — disabling images for this process run until success`,
      );
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buf = new Uint8Array(await res.arrayBuffer());
    return { data: buf, contentType, provider: "pollinations", model: "pollinations" };
  } catch (err) {
    warnOnce(
      "pollinations",
      `[ai/image] pollinations request errored: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function generateWithGemini(model: string, prompt: string): Promise<GeneratedImage | null> {
  if (!env.GOOGLE_API_KEY) {
    warnOnce("gemini-image", "[ai/image] MODEL_IMAGE is gemini:* but GOOGLE_API_KEY is unset — skipping image generation");
    return null;
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseModalities: ["IMAGE", "TEXT"],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return {
          data: Buffer.from(part.inlineData.data, "base64"),
          contentType: part.inlineData.mimeType ?? "image/png",
          provider: "gemini",
          model,
        };
      }
    }

    warnOnce("gemini-image", "[ai/image] Gemini image response had no inlineData part");
    return null;
  } catch (err) {
    // Covers quota exhaustion, permission errors (image gen is paid-only on
    // most keys), and any SDK/network failure — all degrade the same way.
    warnOnce(
      "gemini-image",
      `[ai/image] Gemini image generation errored (likely quota/permission — image gen is paid-only on most free-tier keys): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Generates a scene image for `prompt`, or returns null if image generation
 * is disabled, unconfigured, or fails for any reason. Records a usageEvents
 * row (operation 'image') whenever a real attempt was made, regardless of
 * outcome... actually only on success, to keep the ledger meaningful (a
 * failed attempt spent no billable resource worth tracking).
 */
export async function generateSceneImage(
  prompt: string,
  opts: { bookId?: string; userId?: string } = {},
): Promise<GeneratedImage | null> {
  const slot = env.MODEL_IMAGE;

  if (slot === "none" || !slot) {
    return null;
  }

  if (slot === "pollinations") {
    const image = await generateWithPollinations(prompt);
    if (image) {
      await recordImageUsage({ ...opts, provider: image.provider, model: image.model });
    }
    return image;
  }

  if (slot.startsWith("gemini:")) {
    const model = slot.slice("gemini:".length);
    const image = await generateWithGemini(model, prompt);
    if (image) {
      await recordImageUsage({ ...opts, provider: image.provider, model: image.model });
    }
    return image;
  }

  warnOnce(`unknown-${slot}`, `[ai/image] unknown MODEL_IMAGE slot "${slot}" — skipping image generation`);
  return null;
}
