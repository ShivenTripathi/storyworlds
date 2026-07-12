"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { WorldFormingCard } from "@/components/world/WorldFormingCard";
import { CastList } from "@/components/world/CastList";
import { ProgressChip } from "@/components/world/ProgressChip";
import { SceneView } from "@/components/world/SceneView";
import { useJob } from "@/components/world/useJob";
import { analyzeBook, fetchWorld } from "@/components/world/api";
import type { World, WorldEntity } from "@/components/world/types";
import type { OverlayState } from "./useOverlay";

type WorldTabId = "scene" | "cast" | "chat";

function isCharacter(entity: WorldEntity): boolean {
  const k = entity.kind.toLowerCase().replace(/s$/, "");
  return k === "character" || k === "person";
}

/**
 * Everything a rail panel needs to render itself. Adding a new tab (e.g.
 * "Timeline") means: pick an id, write a small panel component that reads
 * whatever slice of this it needs, and add one entry to `RAIL_TABS`.
 */
interface RailPanelContext {
  bookId: string;
  /** The page currently on screen in the reader. */
  currentChunk: number;
  world: World;
  /** The reader's own overlay fetch for `currentChunk`, shared with ChapterPlate. */
  overlay?: OverlayState;
  /** Scene → Chat handoff: jumps to Chat with a character pre-selected and this question queued. */
  onAskQuestion: (question: string) => void;
  /** Opens (or switches to) a conversation with this character, on the Chat tab. */
  onStartChat: (entityId: string) => void;
  /** Chat tab's own picker/conversation state. */
  chat: {
    entityId: string | null;
    initialMessage?: string;
    onBack: () => void;
  };
}

interface RailTabDef {
  id: WorldTabId;
  label: string;
  /**
   * "flow" (default): stacked content, natural height, `space-y-6` rhythm.
   * "fill": the panel manages its own internal scrolling and needs the
   * rail's full remaining height (e.g. it embeds a live chat thread).
   */
  layout?: "flow" | "fill";
  render: (ctx: RailPanelContext) => ReactNode;
}

const RAIL_TABS: RailTabDef[] = [
  { id: "scene", label: "Scene", render: ScenePanel },
  { id: "cast", label: "Cast", render: CastPanel },
  { id: "chat", label: "Chat", layout: "fill", render: ChatTabPanel },
];

interface WorldRailProps {
  bookId: string;
  open: boolean;
  onClose: () => void;
  /** The page currently on screen in the reader — drives the Scene tab. */
  currentChunk: number;
  /**
   * The reader's own overlay fetch for `currentChunk` (shared with
   * ChapterPlate). When present, SceneView reuses it instead of firing a
   * second request for the same page.
   */
  overlay?: OverlayState;
}

/**
 * The reader's "peek at the world" panel: right-side rail on desktop,
 * bottom sheet on mobile. Self-contained — fetches the world on open and
 * drives its own analysis job if the reader chooses to awaken it from
 * here, mirroring (a lighter version of) the book detail page's flow.
 */
export function WorldRail({
  bookId,
  open,
  onClose,
  currentChunk,
  overlay,
}: WorldRailProps) {
  const [world, setWorld] = useState<World | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [tab, setTab] = useState<WorldTabId>("scene");
  const [chatEntityId, setChatEntityId] = useState<string | null>(null);
  const [chatInitialMessage, setChatInitialMessage] = useState<
    string | undefined
  >(undefined);
  const { job } = useJob(jobId);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevJobStatus = useRef<string | null>(null);

  const loadWorld = useCallback(async () => {
    try {
      const { world: w, job: j } = await fetchWorld(bookId);
      setWorld(w);
      if (j && (j.status === "queued" || j.status === "running")) {
        setJobId(j.id);
      }
    } catch {
      // best-effort — the panel just stays in its last known state
    } finally {
      setLoaded(true);
    }
  }, [bookId]);

  useEffect(() => {
    // Fetch on open — this is a deliberate "sync with server on open" effect,
    // not state derived from props/state already in React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void loadWorld();
  }, [open, loadWorld]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "completed" && prevJobStatus.current !== "completed") {
      void loadWorld();
    }
    prevJobStatus.current = job.status;
  }, [job, loadWorld]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  async function handleAwaken() {
    setWorld((w) => (w ? { ...w, status: "pending" } : { status: "pending" }));
    try {
      const result = await analyzeBook(bookId);
      if (result) {
        setJobId(result.job.id);
      } else {
        await loadWorld();
      }
    } catch {
      setWorld((w) => (w ? { ...w, status: "failed" } : { status: "failed" }));
    }
  }

  /** Opens (or switches to) a conversation with `entityId` on the Chat tab. */
  const startChat = useCallback((entityId: string, initialMessage?: string) => {
    setChatEntityId(entityId);
    setChatInitialMessage(initialMessage);
    setTab("chat");
  }, []);

  const handleAskQuestion = useCallback(
    (question: string) => {
      const firstCharacter = world?.entities?.find(isCharacter);
      if (!firstCharacter) return;
      startChat(firstCharacter.id, question);
    },
    [world, startChat],
  );

  const status = world?.status ?? "none";
  const isPending =
    status === "pending" ||
    (job && (job.status === "queued" || job.status === "running"));
  const isFailed = status === "failed" || job?.status === "failed";

  // The context every rail panel renders from.
  const railCtx: RailPanelContext | null =
    status === "completed" && world
      ? {
          bookId,
          currentChunk,
          world,
          overlay,
          onAskQuestion: handleAskQuestion,
          onStartChat: startChat,
          chat: {
            entityId: chatEntityId,
            initialMessage: chatInitialMessage,
            onBack: () => setChatEntityId(null),
          },
        }
      : null;

  const activeTabDef = RAIL_TABS.find((t) => t.id === tab);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="complementary"
      aria-label="Story world"
      aria-hidden={!open}
      inert={!open ? true : undefined}
      className={`fixed inset-x-0 bottom-0 z-50 h-[60vh] overflow-y-auto rounded-t-lg border-t transition-transform duration-[250ms] ease-out focus:outline-none motion-reduce:transition-none md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[340px] md:rounded-none md:border-t-0 md:border-l ${
        open
          ? "translate-y-0 md:translate-x-0"
          : "translate-y-full md:translate-x-full md:translate-y-0"
      }`}
      style={{
        background: "var(--world-surface)",
        borderColor: "var(--world-frame)",
        // The rail is nested inside the reader, which sets color:var(--reader-fg)
        // (dark in the Paper/Sepia reading themes). Reset to the app foreground
        // so text stays legible on the dark --world-surface regardless of the
        // reader's page theme.
        color: "var(--foreground)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <p className="eyebrow">THE WORLD</p>
        <button
          type="button"
          aria-label="Close world panel"
          onClick={onClose}
          tabIndex={open ? 0 : -1}
          className="flex h-11 w-11 items-center justify-center rounded-full text-lg opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          ×
        </button>
      </div>

      {loaded && railCtx ? (
        <div
          role="tablist"
          aria-label="World panel sections"
          className="flex items-center gap-4 border-b px-4 pb-2"
          style={{ borderColor: "var(--world-frame)" }}
        >
          {RAIL_TABS.map((t) => (
            <TabButton
              key={t.id}
              id={t.id}
              label={t.label}
              active={tab === t.id}
              onClick={() => setTab(t.id)}
            />
          ))}
        </div>
      ) : null}

      <div className="px-4 pt-4 pb-8">
        {!loaded ? (
          <p className="font-ui text-sm text-muted-foreground">
            Opening the world…
          </p>
        ) : railCtx ? (
          <div
            role="tabpanel"
            id={`world-panel-${tab}`}
            aria-labelledby={`world-tab-${tab}`}
            className={
              activeTabDef?.layout === "fill"
                ? "flex h-[calc(60vh-96px)] flex-col outline-none md:h-[calc(100vh-96px)]"
                : "space-y-6 outline-none"
            }
          >
            {activeTabDef?.render(railCtx)}
          </div>
        ) : isFailed ? (
          <WorldFormingCard
            compact
            job={job ?? { id: "", status: "failed", progress: 0, error: null }}
            onRetry={handleAwaken}
          />
        ) : isPending ? (
          <WorldFormingCard
            compact
            job={job ?? { id: "", status: "running", progress: 0, stage: null }}
            onRetry={handleAwaken}
          />
        ) : (
          <div className="space-y-3">
            <p className="font-ui text-sm text-muted-foreground">
              The world of this book hasn&apos;t awoken yet.
            </p>
            <button
              type="button"
              onClick={() => void handleAwaken()}
              className="rounded-full bg-[var(--world-accent)] px-4 py-2 font-ui text-xs font-medium text-[var(--world-accent-fg)] transition-opacity hover:opacity-90"
            >
              Awaken the world
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Scene tab: the illustration + description for the page on screen. */
function ScenePanel(ctx: RailPanelContext) {
  return (
    <SceneView
      bookId={ctx.bookId}
      chunkIdx={ctx.currentChunk}
      preloaded={ctx.overlay}
      onAskQuestion={ctx.onAskQuestion}
    />
  );
}

/** Cast tab: setting blurb + the full entity roster. */
function CastPanel(ctx: RailPanelContext) {
  return (
    <>
      {ctx.world.settingDescription ? (
        <p className="font-reading text-sm leading-relaxed">
          {ctx.world.settingDescription}
        </p>
      ) : null}
      {ctx.world.entities && ctx.world.entities.length > 0 ? (
        <CastList
          entities={ctx.world.entities}
          counts={ctx.world.counts}
          bookId={ctx.bookId}
          onChat={ctx.onStartChat}
        />
      ) : null}
    </>
  );
}

/** Chat tab: thin adapter handing the rail's chat state to `ChatTab` below. */
function ChatTabPanel(ctx: RailPanelContext) {
  return (
    <ChatTab
      bookId={ctx.bookId}
      entities={ctx.world.entities ?? []}
      chunkIdx={ctx.currentChunk}
      entityId={ctx.chat.entityId}
      initialMessage={ctx.chat.initialMessage}
      onSelect={ctx.onStartChat}
      onBack={ctx.chat.onBack}
    />
  );
}

/**
 * The rail's Chat tab: a character picker when nothing's selected yet, or
 * the docked conversation itself (with a back arrow to the picker).
 */
function ChatTab({
  bookId,
  entities,
  chunkIdx,
  entityId,
  initialMessage,
  onSelect,
  onBack,
}: {
  bookId: string;
  entities: World["entities"];
  chunkIdx: number;
  entityId: string | null;
  initialMessage?: string;
  onSelect: (entityId: string) => void;
  onBack: () => void;
}) {
  const characters = (entities ?? []).filter(isCharacter);
  const selected = entityId
    ? characters.find((e) => e.id === entityId)
    : undefined;

  if (!selected) {
    if (characters.length === 0) {
      return (
        <p className="font-ui text-sm text-muted-foreground italic">
          No one has stepped into the light yet.
        </p>
      );
    }
    return (
      <div className="space-y-1">
        <p className="eyebrow mb-2">WHO WOULD YOU LIKE TO TALK TO?</p>
        <ul className="space-y-1">
          {characters.map((entity) => (
            <li key={entity.id}>
              <button
                type="button"
                onClick={() => onSelect(entity.id)}
                className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-2 text-left hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                <span
                  className="min-w-0 flex-1 font-display text-base break-words"
                  title={entity.name}
                >
                  {entity.name}
                </span>
                <ProgressChip introducedAtChunk={entity.introducedAtChunk} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-2 flex items-center gap-1.5 self-start font-ui text-xs text-muted-foreground hover:text-[var(--card-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M10 3L5 8l5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        All characters
      </button>
      <div className="min-h-0 flex-1">
        <ChatPanel
          key={selected.id}
          bookId={bookId}
          entityId={selected.id}
          entityName={selected.name}
          chunkIdx={chunkIdx}
          initialMessage={initialMessage}
        />
      </div>
    </div>
  );
}

function TabButton({
  id,
  label,
  active,
  onClick,
}: {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={`world-tab-${id}`}
      role="tab"
      aria-selected={active}
      aria-controls={`world-panel-${id}`}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className="eyebrow -mb-px shrink-0 rounded-t-sm border-b-2 pb-2 whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      style={{
        borderColor: active ? "var(--world-accent)" : "transparent",
        color: active ? "var(--card-foreground)" : "var(--muted-foreground)",
      }}
    >
      {label}
    </button>
  );
}
