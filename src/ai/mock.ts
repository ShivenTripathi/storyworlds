import { ARCHETYPES } from "@/theme/archetypes";

/**
 * Deterministic fake LLM driver used when ANTHROPIC_API_KEY is unset. Output
 * shapes match `src/domain/schemas.ts` (SegmentAnalysisSchema /
 * WorldSynthesisSchema) closely enough to parse through the real zod schemas
 * — `completeJson` in client.ts still validates everything this returns.
 */

export interface MockDriverRunOpts {
  operation: "segment" | "synthesis" | "chat" | "overlay";
  model: string;
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
}

export interface MockDriverResult {
  raw: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const STOPWORDS = new Set([
  "The",
  "This",
  "That",
  "Page",
  "Segment",
  "Extract",
  "Book",
]);

/** Pull up to `limit` capitalized multi-occurrence words out of `text`. */
function extractCapitalizedNames(text: string, limit: number): string[] {
  const matches = text.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  const counts = new Map<string, number>();
  for (const word of matches) {
    if (STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

export interface MockDriverStreamOpts {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface MockDriverStreamResult {
  textStream: AsyncIterable<string>;
  usage: Promise<{ inputTokens: number; outputTokens: number }>;
  model: string;
}

const MOCK_STREAM_WORD_DELAY_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pull the character name out of a persona system prompt built by
 * buildPersona ("You are {name}. Stay strictly in character. ..."). */
function extractCharacterName(system: string): string {
  const match = system.match(/^You are ([^.]+)\./);
  return match ? match[1].trim() : "the character";
}

/** A deterministic, obviously-mock two-sentence in-character reply, so mock
 * mode is visually distinguishable and streaming is testable end-to-end
 * without a real model. */
function buildMockChatReply(system: string, prompt: string): string {
  const name = extractCharacterName(system);
  const isFutureQuestion =
    /\b(happen|will|future|end up|fate|later|eventually)\b/i.test(prompt);
  if (isFutureQuestion) {
    return `${name} looks away for a moment, uncertain. "I couldn't tell you what's still ahead of me — I only know what I've lived through so far."`;
  }
  return `${name} considers the question carefully. "That's closer to the truth of it than you might expect," ${name} says (mock reply).`;
}

export class MockDriver {
  readonly provider = "mock";

  async run(opts: MockDriverRunOpts): Promise<MockDriverResult> {
    const raw = buildMockOutput(opts.operation, opts.prompt);
    return {
      raw,
      model: `${opts.model}-mock`,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  async stream(opts: MockDriverStreamOpts): Promise<MockDriverStreamResult> {
    const reply = buildMockChatReply(opts.system, opts.prompt);
    // Split on whitespace but keep the delimiter attached to each word so
    // re-joining the yielded deltas reproduces the original text exactly.
    const words = reply.match(/\S+\s*/g) ?? [reply];

    async function* textStream(): AsyncGenerator<string> {
      for (const word of words) {
        await sleep(MOCK_STREAM_WORD_DELAY_MS);
        yield word;
      }
    }

    return {
      textStream: textStream(),
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
      model: `${opts.model}-mock`,
    };
  }
}

function buildMockOutput(
  operation: MockDriverRunOpts["operation"],
  prompt: string,
): unknown {
  switch (operation) {
    case "segment":
      return buildMockSegment(prompt);
    case "synthesis":
      return buildMockSynthesis(prompt);
    case "overlay":
      return buildMockOverlay(prompt);
    default:
      return { text: "Mock response." };
  }
}

function buildMockSegment(prompt: string) {
  const names = extractCapitalizedNames(prompt, 8);

  return {
    entities: names.map((name) => ({
      name,
      kind: "character" as const,
      aliases: [name],
      description: `${name} appears in this segment.`,
      visualDescription: `A figure known as ${name}.`,
      firstSeenPage: undefined,
    })),
    events: [
      { summary: "An early event occurs in this segment.", page: undefined },
      { summary: "A later event occurs in this segment.", page: undefined },
    ],
    settingNotes: "A generic setting, atmosphere unspecified (mock).",
  };
}

/** Pull the bulleted entity names out of the "Known entity names" section built by buildOverlayPrompt. */
function extractEntityListNames(prompt: string, limit: number): string[] {
  const match = prompt.match(
    /Known entity names for this book[^:]*:\n([\s\S]*?)\n\nPage text:/,
  );
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter((line) => line.length > 0 && line !== "(no known entities yet)")
    .slice(0, limit);
}

/** Pull the page text out of the prompt built by buildOverlayPrompt. */
function extractPageText(prompt: string): string {
  const match = prompt.match(/Page text:\n([\s\S]*?)\n\nGenerate the overlay/);
  return match ? match[1] : prompt;
}

function buildMockOverlay(prompt: string) {
  const pageText = extractPageText(prompt);
  const entityNames = extractEntityListNames(prompt, 3);

  return {
    sceneDescription:
      pageText.slice(0, 200).trim() || "A quiet moment on the page (mock).",
    activeEntities: entityNames.map((name) => ({ name })),
    mood: "contemplative",
    interpretiveNotes: "A mock interpretive note for this page.",
    suggestedQuestions: [
      "What are you thinking right now?",
      "What do you want most in this moment?",
    ],
  };
}

function buildMockSynthesis(prompt: string) {
  const names = extractCapitalizedNames(prompt, 8);
  const entityNames = names.length > 0 ? names : ["Protagonist"];

  return {
    settingDescription: "A world synthesized from mock analysis notes.",
    blurb:
      "A world is taking shape on the page — a cast of strangers, a setting " +
      "still coming into focus, and a story that hasn't shown its hand yet. " +
      "Step in and meet them as they're introduced (mock blurb).",
    visualStyle: {
      artStyle: "engraved illustration",
      colorPalette: "warm amber",
      mood: "contemplative",
      eraSetting: "unknown",
      themeArchetype: ARCHETYPES[0],
    },
    entities: entityNames.map((name) => ({
      name,
      kind: "character" as const,
      aliases: [name],
      attributes: {
        description: `${name} is introduced early in the story, already carrying the traits that will come to define them (mock).`,
        role: "unknown",
        internalState: undefined,
        keyMotivation: undefined,
        scars: undefined,
      },
      visualDescription: `A figure known as ${name}.`,
      introducedAtPage: undefined,
    })),
    timeline: [
      { label: "Beginning", summary: "The story begins.", approxPage: 1 },
      {
        label: "Middle",
        summary: "The story develops.",
        approxPage: undefined,
      },
      { label: "End", summary: "The story concludes.", approxPage: undefined },
    ],
    commitments: [
      {
        claim: "A fact established early in the book.",
        status: "open" as const,
      },
    ],
    unknowns: [
      { question: "An open question raised by the book.", kind: "mystery" },
    ],
  };
}
