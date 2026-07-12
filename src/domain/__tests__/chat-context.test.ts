import { describe, expect, it } from "vitest";
import {
  type EntityCandidate,
  selectRelevantContext,
  summarizeOlderTurns,
  type TimelineItem,
} from "../chat-context";

const CANDIDATES: EntityCandidate[] = [
  {
    id: "char:paul-atreides",
    name: "Paul Atreides",
    role: "protagonist",
    aliases: ["muad'dib", "usul"],
  },
  { id: "char:chani", name: "Chani", role: "fremen warrior", aliases: [] },
  {
    id: "char:baron",
    name: "Vladimir Harkonnen",
    role: "antagonist",
    aliases: ["the baron"],
  },
];

const TIMELINE: TimelineItem[] = [
  {
    label: "Arrival on Arrakis",
    summary: "The Atreides take stewardship of the desert planet.",
    approxPage: 40,
  },
  {
    label: "Betrayal",
    summary: "Harkonnen forces overrun the Atreides household.",
    approxPage: 120,
  },
  {
    label: "Into the desert",
    summary: "Paul and his mother flee among the Fremen.",
    approxPage: 160,
  },
  {
    label: "The water of life",
    summary: "Chani helps Paul survive the ordeal.",
    approxPage: 300,
  },
];

describe("selectRelevantContext", () => {
  it("picks the entity named in the message", () => {
    const r = selectRelevantContext({
      message: "Chani, do you trust the Fremen leadership?",
      candidates: CANDIDATES,
      timeline: TIMELINE,
    });
    expect(r.entities.map((e) => e.name)).toContain("Chani");
    expect(r.entities.map((e) => e.name)).not.toContain("Vladimir Harkonnen");
  });

  it("matches an entity by alias, not just its display name", () => {
    const r = selectRelevantContext({
      message: "What did the Baron want from all this?",
      candidates: CANDIDATES,
      timeline: TIMELINE,
    });
    expect(r.entities.map((e) => e.name)).toContain("Vladimir Harkonnen");
  });

  it("selects the relevant timeline slice for the question, not the whole thing", () => {
    const r = selectRelevantContext({
      message: "Tell me about the betrayal by the Harkonnens.",
      candidates: CANDIDATES,
      timeline: TIMELINE,
      maxTimeline: 5,
    });
    expect(r.timeline.length).toBeLessThan(TIMELINE.length);
    expect(r.timeline.map((t) => t.label)).toContain("Betrayal");
  });

  it("falls back to the most recent entries when nothing matches", () => {
    const r = selectRelevantContext({
      message: "How are you feeling right now?",
      candidates: CANDIDATES,
      timeline: TIMELINE,
    });
    // Recency fallback returns the last <=3 entries, never zero context.
    expect(r.timeline.length).toBeGreaterThan(0);
    expect(r.timeline.length).toBeLessThanOrEqual(3);
    expect(r.timeline).toContain(TIMELINE[TIMELINE.length - 1]);
  });

  it("does not match a name substring across word boundaries", () => {
    const r = selectRelevantContext({
      message: "I ate a banana this morning.",
      candidates: [{ id: "char:ana", name: "Ana", role: "cook", aliases: [] }],
      timeline: [],
    });
    expect(r.entities).toHaveLength(0);
  });

  it("caps the number of returned entities", () => {
    const many: EntityCandidate[] = Array.from({ length: 8 }, (_, i) => ({
      id: `char:c${i}`,
      name: `Name${i}`,
      aliases: [],
    }));
    const r = selectRelevantContext({
      message: many.map((c) => c.name).join(" "),
      candidates: many,
      timeline: [],
      maxEntities: 3,
    });
    expect(r.entities.length).toBe(3);
  });
});

describe("summarizeOlderTurns", () => {
  it("returns undefined when there are no older turns", () => {
    expect(summarizeOlderTurns([])).toBeUndefined();
  });

  it("summarizes older turns as a breadcrumb note mentioning the reader's questions", () => {
    const note = summarizeOlderTurns([
      { role: "user", content: "Where were you born?" },
      { role: "assistant", content: "On Caladan." },
      { role: "user", content: "Do you miss the sea?" },
      { role: "assistant", content: "Every day." },
    ]);
    expect(note).toBeDefined();
    expect(note).toContain("2 earlier exchanges");
    expect(note).toContain("Where were you born?");
  });
});
