import { z } from "zod";
import { db, dbReady } from "@/db";
import { usageEvents } from "@/db/schema";
import { env } from "@/lib/env";
import { MockDriver } from "./mock";

export type LlmOperation = "segment" | "synthesis" | "chat" | "overlay";

export interface CompleteJsonOptions<S extends z.ZodTypeAny> {
  operation: LlmOperation;
  system: string;
  prompt: string;
  schema: S;
  bookId?: string;
  userId?: string;
  maxTokens?: number;
}

interface DriverResult {
  raw: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

interface LlmDriver {
  readonly provider: string;
  run(opts: {
    operation: LlmOperation;
    model: string;
    system: string;
    prompt: string;
    jsonSchema: Record<string, unknown>;
    maxTokens: number;
  }): Promise<DriverResult>;
}

// ---------------------------------------------------------------------------
// Pricing (USD per million tokens). Unknown models default to 0 cost rather
// than throwing — usage tracking should never block a request.
// ---------------------------------------------------------------------------
const PRICE_TABLE: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
  "claude-sonnet-5": { in: 3.0, out: 15.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
  // Google AI Studio free tier — $0 as long as usage stays under the free
  // RPM/RPD caps (see ZERO-COST CONSTRAINT in CLAUDE.md). We never bill for
  // these; if the free tier is exceeded the API call itself fails (429)
  // rather than silently incurring cost.
  "gemini-2.5-flash": { in: 0, out: 0 },
  "gemini-2.5-flash-lite": { in: 0, out: 0 },
  "gemini-2.5-flash-image": { in: 0, out: 0 },
};

// ---------------------------------------------------------------------------
// Provider-prefixed model slots: `gemini:gemini-2.5-flash-lite`,
// `anthropic:claude-haiku-4-5`, or a bare model name (back-compat: treated
// as `anthropic:`).
// ---------------------------------------------------------------------------
type Provider = "anthropic" | "gemini";

function parseModelSlot(slot: string): { provider: Provider; model: string } {
  const idx = slot.indexOf(":");
  if (idx === -1) {
    return { provider: "anthropic", model: slot };
  }
  const prefix = slot.slice(0, idx);
  const model = slot.slice(idx + 1);
  if (prefix === "gemini" || prefix === "anthropic") {
    return { provider: prefix, model };
  }
  // Unknown prefix — fall back to treating the whole slot as an Anthropic
  // model name rather than guessing.
  return { provider: "anthropic", model: slot };
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_TABLE[model] ?? { in: 0, out: 0 };
  return (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out;
}

function modelForOperation(operation: LlmOperation): string {
  switch (operation) {
    case "segment":
      return env.MODEL_SEGMENT;
    case "synthesis":
      return env.MODEL_SYNTHESIS;
    case "chat":
      return env.MODEL_CHAT;
    case "overlay":
      return env.MODEL_SEGMENT;
    default:
      return env.MODEL_SEGMENT;
  }
}

const warnedMockForProvider = new Set<Provider>();
function warnMockOnce(provider: Provider, missingEnvVar: string) {
  if (!warnedMockForProvider.has(provider)) {
    warnedMockForProvider.add(provider);
    console.warn(
      `[ai] LLM mock mode — ${missingEnvVar} not set, using MockDriver for provider "${provider}"`,
    );
  }
}

const driverCache = new Map<Provider, LlmDriver>();

/**
 * Resolves the driver for a given provider. Missing API key -> MockDriver
 * (with a one-time warn) so dev stays keyless-friendly; this must never
 * throw.
 */
function getDriver(provider: Provider): LlmDriver {
  const cached = driverCache.get(provider);
  if (cached) return cached;

  let driver: LlmDriver;
  if (provider === "gemini") {
    if (env.GOOGLE_API_KEY) {
      driver = new GeminiDriver(env.GOOGLE_API_KEY);
    } else {
      warnMockOnce("gemini", "GOOGLE_API_KEY");
      driver = new MockDriver();
    }
  } else {
    if (env.ANTHROPIC_API_KEY) {
      driver = new AnthropicDriver(env.ANTHROPIC_API_KEY);
    } else {
      warnMockOnce("anthropic", "ANTHROPIC_API_KEY");
      driver = new MockDriver();
    }
  }

  driverCache.set(provider, driver);
  return driver;
}

// ---------------------------------------------------------------------------
// Gemini `responseSchema` is an OpenAPI-3.0-ish subset of JSON Schema: no
// $schema/$ref/$defs, no additionalProperties, no numeric/string bounds
// (minLength, minimum, maximum, etc), no `default`. This strips a draft-7
// JSON Schema (as produced by z.toJSONSchema) down to the keywords Gemini
// accepts, resolving any `$ref`/`$defs` inline along the way.
// ---------------------------------------------------------------------------
const GEMINI_SCHEMA_KEYS = [
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "description",
] as const;

export function sanitizeSchemaForGemini(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const defs = (schema.$defs ?? schema.definitions ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  function resolve(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map(resolve);
    }
    if (node === null || typeof node !== "object") {
      return node;
    }
    const obj = node as Record<string, unknown>;

    const ref = obj.$ref;
    if (typeof ref === "string") {
      const name = ref.replace(/^#\/(\$defs|definitions)\//, "");
      const target = defs[name];
      return target ? resolve(target) : {};
    }

    const out: Record<string, unknown> = {};
    for (const key of GEMINI_SCHEMA_KEYS) {
      if (!(key in obj)) continue;
      if (key === "properties") {
        const props = obj.properties as Record<string, unknown>;
        out.properties = Object.fromEntries(
          Object.entries(props).map(([k, v]) => [k, resolve(v)]),
        );
      } else if (key === "items") {
        out.items = resolve(obj.items);
      } else {
        out[key] = obj[key];
      }
    }
    return out;
  }

  return resolve(schema) as Record<string, unknown>;
}

class AnthropicDriver implements LlmDriver {
  readonly provider = "anthropic";
  private client: import("@anthropic-ai/sdk").default | undefined;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async getClient() {
    if (!this.client) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async run(opts: {
    operation: LlmOperation;
    model: string;
    system: string;
    prompt: string;
    jsonSchema: Record<string, unknown>;
    maxTokens: number;
  }): Promise<DriverResult> {
    const client = await this.getClient();

    const tool = {
      name: "emit",
      description: "Emit the structured result.",
      input_schema: opts.jsonSchema as unknown as Record<string, unknown>,
    };

    const response = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      tools: [tool as never],
      tool_choice: { type: "tool", name: "emit" },
      messages: [{ role: "user", content: opts.prompt }],
    });

    const toolUse = response.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    );
    if (!toolUse) {
      throw new Error("Anthropic response did not contain a tool_use block");
    }

    return {
      raw: toolUse.input,
      model: response.model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Gemini driver — Google AI Studio free tier (the zero-cost default text
// LLM; see ZERO-COST CONSTRAINT in CLAUDE.md). Free-tier RPM is low (15 RPM
// flash / 30 RPM flash-lite), so 429/RESOURCE_EXHAUSTED gets exponential
// backoff with jitter instead of failing the request outright.
// ---------------------------------------------------------------------------
const GEMINI_BACKOFF_BASE_MS = 5_000;
const GEMINI_BACKOFF_FACTOR = 2;
const GEMINI_BACKOFF_MAX_ATTEMPTS = 3;
const GEMINI_BACKOFF_MAX_MS = 60_000;

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string; name?: string };
  if (e.status === 429) return true;
  const msg = `${e.message ?? ""} ${e.name ?? ""}`;
  return /RESOURCE_EXHAUSTED|429/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class GeminiDriver implements LlmDriver {
  readonly provider = "gemini";
  private client: import("@google/genai").GoogleGenAI | undefined;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async getClient() {
    if (!this.client) {
      const { GoogleGenAI } = await import("@google/genai");
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async run(opts: {
    operation: LlmOperation;
    model: string;
    system: string;
    prompt: string;
    jsonSchema: Record<string, unknown>;
    maxTokens: number;
  }): Promise<DriverResult> {
    const client = await this.getClient();
    const responseSchema = sanitizeSchemaForGemini(opts.jsonSchema);

    let attempt = 0;
    for (;;) {
      try {
        const response = await client.models.generateContent({
          model: opts.model,
          contents: opts.prompt,
          config: {
            systemInstruction: opts.system,
            responseMimeType: "application/json",
            responseSchema: responseSchema as never,
            maxOutputTokens: opts.maxTokens,
          },
        });

        const text = response.text;
        if (!text) {
          throw new Error("Gemini response had no text content");
        }

        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new Error(`Gemini response was not valid JSON: ${text.slice(0, 500)}`);
        }

        return {
          raw,
          model: opts.model,
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        };
      } catch (err) {
        attempt += 1;
        if (!isRateLimitError(err) || attempt >= GEMINI_BACKOFF_MAX_ATTEMPTS) {
          throw err;
        }
        const delay = Math.min(
          GEMINI_BACKOFF_MAX_MS,
          GEMINI_BACKOFF_BASE_MS * GEMINI_BACKOFF_FACTOR ** (attempt - 1),
        );
        const jitter = Math.random() * delay * 0.25;
        const waitMs = Math.round(delay + jitter);
        console.warn(
          `[ai] Gemini free-tier rate limit hit (model=${opts.model}, attempt ${attempt}/${GEMINI_BACKOFF_MAX_ATTEMPTS}) — retrying in ${waitMs}ms`,
        );
        await sleep(waitMs);
      }
    }
  }
}

async function recordUsage(opts: {
  operation: LlmOperation;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  bookId?: string;
  userId?: string;
}) {
  try {
    await dbReady;
    await db.insert(usageEvents).values({
      bookId: opts.bookId ?? null,
      userId: opts.userId ?? null,
      provider: opts.provider,
      model: opts.model,
      operation: opts.operation,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      costUsd: costUsd(opts.model, opts.inputTokens, opts.outputTokens).toFixed(6),
    });
  } catch (err) {
    console.error("[ai] failed to record usage event:", err);
  }
}

/**
 * The one LLM entry point for the whole app. Selects a driver (Anthropic if
 * ANTHROPIC_API_KEY is set, otherwise a deterministic MockDriver), forces
 * tool-shaped JSON output, validates it through `schema`, retries once on a
 * ZodError with the error appended to the prompt, and always records a
 * usageEvents row (even for the mock driver, with zero-cost tokens).
 */
export async function completeJson<S extends z.ZodTypeAny>(
  opts: CompleteJsonOptions<S>,
): Promise<z.infer<S>> {
  // zod v4 ships native JSON Schema conversion; zod-to-json-schema (built
  // for zod v3's internal `_def` shape) silently produces an empty schema
  // against zod v4 input, so we use z.toJSONSchema directly here instead.
  // `unrepresentable: "any"` is required because some schemas (e.g.
  // OverlaySchema.suggestedQuestions) use `.transform()` for post-parse
  // shaping (trimming to a max length) that has no JSON Schema equivalent —
  // without this the conversion throws instead of just widening that one
  // field to `{}` (unconstrained) in the schema handed to the model.
  const resolvedSchema = z.toJSONSchema(opts.schema, {
    target: "draft-7",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete resolvedSchema.$schema;

  const { provider, model } = parseModelSlot(modelForOperation(opts.operation));
  const driver = getDriver(provider);
  const maxTokens = opts.maxTokens ?? 8192;

  let prompt = opts.prompt;
  let lastResult: DriverResult | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await driver.run({
      operation: opts.operation,
      model,
      system: opts.system,
      prompt,
      jsonSchema: resolvedSchema,
      maxTokens,
    });
    lastResult = result;

    const parsed = opts.schema.safeParse(result.raw);
    if (parsed.success) {
      await recordUsage({
        operation: opts.operation,
        provider: driver.provider,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        bookId: opts.bookId,
        userId: opts.userId,
      });
      return parsed.data;
    }

    lastError = parsed.error;
    prompt = `${opts.prompt}\n\nYour previous response failed schema validation with the following error. Fix it and emit again:\n${parsed.error.toString()}`;
  }

  // Both attempts failed — still record usage for the final attempt before
  // throwing, since the model was called and tokens were spent.
  if (lastResult) {
    await recordUsage({
      operation: opts.operation,
      provider: driver.provider,
      model: lastResult.model,
      inputTokens: lastResult.inputTokens,
      outputTokens: lastResult.outputTokens,
      bookId: opts.bookId,
      userId: opts.userId,
    });
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("completeJson: schema validation failed after retry");
}
