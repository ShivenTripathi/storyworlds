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

export interface PersonaKnowledge {
  attributes: PersonaAttributes;
  visibleTimeline: PersonaTimelineItem[];
}

const SETTING_DESCRIPTION_CAP = 800;
const CURRENT_PAGE_CAP = 1000;

function cap(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function formatAttributes(entity: PersonaEntity, attributes: PersonaAttributes): string {
  const lines: string[] = [];
  if (attributes.role) lines.push(`Role: ${attributes.role}`);
  if (entity.visualDescription) lines.push(`Appearance: ${entity.visualDescription}`);
  if (attributes.internalState) lines.push(`Internal state: ${attributes.internalState}`);
  if (attributes.keyMotivation) lines.push(`Motivation: ${attributes.keyMotivation}`);
  if (attributes.scars) lines.push(`Scars: ${attributes.scars}`);
  return lines.length > 0 ? lines.join("\n") : "(no further detail known yet)";
}

function formatTimeline(items: PersonaTimelineItem[]): string {
  if (items.length === 0) return "(nothing notable yet)";
  return items.map((t) => `- ${t.label}: ${t.summary}`).join("\n");
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
  knowledge: PersonaKnowledge;
  currentPageText: string;
  settingDescription: string;
}): string {
  const { entity, mode, knowledge, currentPageText, settingDescription } = opts;

  const shared = `You are ${entity.name}. Stay strictly in character. Never break the fourth wall. Never mention being an AI.`;

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

${formatAttributes(entity, knowledge.attributes)}

World setting: ${cap(settingDescription, SETTING_DESCRIPTION_CAP)}

What you know${mode === "story_so_far" ? " so far" : " (the whole story)"}:
${formatTimeline(knowledge.visibleTimeline)}

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
 */
export function buildChatPrompt(opts: { history: ChatHistoryTurn[]; message: string }): string {
  const transcript = opts.history
    .map((m) => `${m.role === "user" ? "USER" : "CHARACTER"}: ${m.content}`)
    .join("\n");

  return `${transcript ? `${transcript}\n` : ""}USER: ${opts.message}\nCHARACTER:`;
}
