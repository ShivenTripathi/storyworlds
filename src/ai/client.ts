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
};

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

let warnedMock = false;
function warnMockOnce() {
  if (!warnedMock) {
    warnedMock = true;
    console.warn("[ai] LLM mock mode — ANTHROPIC_API_KEY not set, using MockDriver");
  }
}

let cachedDriver: LlmDriver | undefined;
function getDriver(): LlmDriver {
  if (cachedDriver) return cachedDriver;
  if (env.ANTHROPIC_API_KEY) {
    cachedDriver = new AnthropicDriver(env.ANTHROPIC_API_KEY);
  } else {
    warnMockOnce();
    cachedDriver = new MockDriver();
  }
  return cachedDriver;
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
  const resolvedSchema = z.toJSONSchema(opts.schema, {
    target: "draft-7",
  }) as Record<string, unknown>;
  delete resolvedSchema.$schema;

  const driver = getDriver();
  const model = modelForOperation(opts.operation);
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
