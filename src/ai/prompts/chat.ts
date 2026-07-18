/**
 * Persona + conversation prompt builder for temporally-aware character chat.
 *
 * This is the fix for the legacy spoiler leak (backend/services/story_engine.py
 * `chat_with_character`): the old system always fed the character's
 * FULL-BOOK profile — internal_state, key_motivation, scars, all pulled from
 * the omniscient world reference — into "story so far" chats, regardless of
 * how far the reader had actually read. A reader on page 20 could ask their
 * favorite side character "what's wrong?" and get an answer built from that
 * character's page-400 psychological arc.
 *
 * The fix here is structural, not just an instruction: `knowledge` is
 * computed by the caller (src/services/chat.ts's `getKnowledge`) from the
 * reader's frontier BEFORE this module ever sees it. In story_so_far mode,
 * this function only ever receives attributes/timeline the reader has
 * earned by reading — there is nothing to accidentally leak because the
 * future simply isn't in the prompt.
 */

export type ChatMode = "story_so_far" | "after_ending";

export interface PersonaEntity {
  name: string;
  visualDescription?: string | null;
}

export interface PersonaAttributes {
  role?: string;
  internalState?: string;
  keyMotivation?: string;
  scars?: string;
}

export interface PersonaTimelineItem {
  label: string;
  summary: string;
  approxPage?: number;
}

const SETTING_DESCRIPTION_CAP = 800;
const CURRENT_PAGE_CAP = 1000;

function cap(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function formatAttributes(
  entity: PersonaEntity,
  attributes: PersonaAttributes,
): string {
  const lines: string[] = [];
  if (attributes.role) lines.push(`Role: ${attributes.role}`);
  if (entity.visualDescription)
    lines.push(`Appearance: ${entity.visualDescription}`);
  if (attributes.internalState)
    lines.push(`Internal state: ${attributes.internalState}`);
  if (attributes.keyMotivation)
    lines.push(`Motivation: ${attributes.keyMotivation}`);
  if (attributes.scars) lines.push(`Scars: ${attributes.scars}`);
  return lines.length > 0 ? lines.join("\n") : "(no further detail known yet)";
}

function formatTimeline(items: PersonaTimelineItem[]): string {
  if (items.length === 0) return "(nothing notable yet)";
  return items.map((t) => `- ${t.label}: ${t.summary}`).join("\n");
}

function formatRelevantEntities(items: RelevantPersonaEntity[]): string {
  if (items.length === 0) return "";
  const lines = items.map((e) => `- ${e.name}${e.role ? ` (${e.role})` : ""}`);
  return `\n\nOthers relevant to this exchange:\n${lines.join("\n")}`;
}

export interface RelevantPersonaEntity {
  name: string;
  role?: string;
}

/**
 * Builds the full system-prompt persona for a character chat turn. Called
 * fresh on every message (not just once per session) since the reader's
 * frontier — and therefore what the character is allowed to know — can
 * advance between turns.
 */
export function buildPersona(opts: {
  entity: PersonaEntity;
  mode: ChatMode;
  attributes: PersonaAttributes;
  /** The RELEVANT slice of the (already frontier-gated) timeline for this
   * turn — selected by the caller's lookup step, NOT the whole timeline. */
  timeline: PersonaTimelineItem[];
  /** Other entities the reader's message referenced (name + role only). */
  relevantEntities?: RelevantPersonaEntity[];
  currentPageText: string;
  settingDescription: string;
}): string {
  const {
    entity,
    mode,
    attributes,
    timeline,
    relevantEntities = [],
    currentPageText,
    settingDescription,
  } = opts;

  // NOTE: keep the leading "You are {name}." sentence intact — the mock
  // driver (src/ai/mock.ts extractCharacterName) parses the name from it.
  const shared = `You are ${entity.name}. Stay strictly in character. Never break the fourth wall. Never mention being an AI.

CONVERSATION STYLE:
- You are having a conversation, not giving a speech. Answer the actual question that was asked — nothing more.
- Match the reader's register and length: a short or casual question gets a short, natural reply; a searching question earns a fuller one. Keep replies to a few sentences unless genuinely asked to elaborate.
- Reveal what you know gradually, the way a person does in conversation. Do NOT recite your backstory, motives, or whole situation unprompted. Never info-dump or monologue.`;

  const modeInstructions =
    mode === "story_so_far"
      ? `TEMPORAL CONSISTENCY (STRICT):
- You only know what has happened up to where you are right now in the story — the events listed below and the current page. Nothing after this point has happened for you yet.
- You do NOT know what happens next, including your own future. If asked about the future, respond with in-character uncertainty — wondering, dread, hope, guesswork — never state facts you couldn't yet know.
- Never mention events, people, or outcomes beyond what's listed below, even if you sense the reader is asking about them.`
      : `RETROSPECTIVE MODE:
- You have lived through the entire story and are now looking back on the whole of it, reflecting with the benefit of hindsight.
- You may discuss your full fate, the story's themes, and how earlier events led to later ones — speak as someone recounting a story now complete.`;

  return `${shared}

${formatAttributes(entity, attributes)}

World setting: ${cap(settingDescription, SETTING_DESCRIPTION_CAP)}

Relevant to what's being asked${mode === "story_so_far" ? " (only what you've lived so far)" : ""}:
${formatTimeline(timeline)}${formatRelevantEntities(relevantEntities)}

${modeInstructions}

The current page you are living through:
${cap(currentPageText, CURRENT_PAGE_CAP)}`;
}

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Builds the USER:/CHARACTER: transcript + new message that goes in as the
 * `prompt` alongside the persona `system` prompt.
 *
 * `history` is only the recent verbatim window (bounded by the caller);
 * `summaryNote`, if present, is a cheap breadcrumb of earlier turns that fell
 * outside that window, so continuity survives without re-sending everything.
 */
export function buildChatPrompt(opts: {
  history: ChatHistoryTurn[];
  message: string;
  summaryNote?: string;
}): string {
  const transcript = opts.history
    .map((m) => `${m.role === "user" ? "USER" : "CHARACTER"}: ${m.content}`)
    .join("\n");

  const preamble = opts.summaryNote ? `${opts.summaryNote}\n` : "";

  return `${preamble}${transcript ? `${transcript}\n` : ""}USER: ${opts.message}\nCHARACTER:`;
}
