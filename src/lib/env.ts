import { z } from "zod";

/**
 * Zod-validated environment accessor.
 *
 * All variables are optional and fall back to sensible dev defaults so the
 * app can boot with zero configuration:
 *  - No DATABASE_URL  -> local PGlite dev database
 *  - No CLERK keys    -> Clerk "keyless" dev mode
 *  - No GOOGLE_API_KEY-> mock LLM driver
 */
const envSchema = z.object({
  // --- Database ---
  DATABASE_URL: z.string().url().optional(),

  // --- Auth / Clerk ---
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),

  // --- Storage ---
  // 'local' (dev filesystem), 'db' (Neon bytea — zero-cost prod default), or
  // 'r2' (Cloudflare R2 — requires a card, avoid in the card-free profile).
  STORAGE_DRIVER: z.enum(["local", "db", "r2"]).default("local"),
  R2_ENDPOINT: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  // --- LLM providers ---
  ANTHROPIC_API_KEY: z.string().optional(),
  // Google AI Studio free-tier key (no card required): aistudio.google.com/apikey
  GOOGLE_API_KEY: z.string().optional(),

  // --- Model slots ---
  // Values may be provider-prefixed (`gemini:gemini-2.5-flash-lite`,
  // `anthropic:claude-haiku-4-5`); a bare model name is treated as
  // `anthropic:` for backward compat. Defaults target Google AI Studio's
  // free tier (card-free) — see ZERO-COST CONSTRAINT in CLAUDE.md.
  MODEL_SEGMENT: z.string().default("gemini:gemini-2.5-flash-lite"),
  MODEL_SYNTHESIS: z.string().default("gemini:gemini-2.5-flash"),
  MODEL_CHAT: z.string().default("gemini:gemini-2.5-flash-lite"),
  MODEL_IMAGE: z.string().default("none"),
  // Illustrate every Nth page (chunkIdx % IMAGE_INTERVAL === 0). Mirrors
  // books.imageInterval as a global fallback/default.
  IMAGE_INTERVAL: z.coerce.number().int().positive().default(5),

  // --- App ---
  APP_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables: ${parsed.error.toString()}`,
    );
  }
  return parsed.data;
}

/**
 * Lazily-parsed, memoized environment object. Accessing any property
 * triggers a one-time parse/validation of `process.env`.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string | symbol) {
    if (!cached) {
      cached = parseEnv();
    }
    return cached[prop as keyof Env];
  },
});
