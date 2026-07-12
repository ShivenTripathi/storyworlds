"use client";

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

type WorldTab = "scene" | "cast" | "chat";

function isCharacter(entity: WorldEntity): boolean {
  const k = entity.kind.toLowerCase().replace(/s$/, "");
  return k === "character" || k === "person";
}

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
  const [tab, setTab] = useState<WorldTab>("scene");
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

  const handleAskQuestion = useCallback(
    (question: string) => {
      const firstCharacter = world?.entities?.find(isCharacter);
      if (!firstCharacter) return;
      setChatEntityId(firstCharacter.id);
      setChatInitialMessage(question);
      setTab("chat");
    },
    [world],
  );

  const status = world?.status ?? "none";
  const isPending =
    status === "pending" ||
    (job && (job.status === "queued" || job.status === "running"));
  const isFailed = status === "failed" || job?.status === "failed";

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

      {loaded && status === "completed" && world ? (
        <div
          className="flex items-center gap-4 border-b px-4 pb-2"
          style={{ borderColor: "var(--world-frame)" }}
        >
          <TabButton
            label="Scene"
            active={tab === "scene"}
            onClick={() => setTab("scene")}
          />
          <TabButton
            label="Cast"
            active={tab === "cast"}
            onClick={() => setTab("cast")}
          />
          <TabButton
            label="Chat"
            active={tab === "chat"}
            onClick={() => setTab("chat")}
          />
        </div>
      ) : null}

      <div className="px-4 pt-4 pb-8">
        {!loaded ? (
          <p className="font-ui text-sm text-muted-foreground">
            Opening the world…
          </p>
        ) : status === "completed" && world ? (
          <div
            className={
              tab === "chat"
                ? "flex h-[calc(60vh-96px)] flex-col md:h-[calc(100vh-96px)]"
                : "space-y-6"
            }
          >
            {tab === "scene" ? (
              <SceneView
                bookId={bookId}
                chunkIdx={currentChunk}
                preloaded={overlay}
                onAskQuestion={handleAskQuestion}
              />
            ) : tab === "cast" ? (
              <>
                {world.settingDescription ? (
                  <p className="font-reading text-sm leading-relaxed">
                    {world.settingDescription}
                  </p>
                ) : null}
                {world.entities && world.entities.length > 0 ? (
                  <CastList
                    entities={world.entities}
                    counts={world.counts}
                    bookId={bookId}
                    onChat={(entityId) => {
                      setChatEntityId(entityId);
                      setChatInitialMessage(undefined);
                      setTab("chat");
                    }}
                  />
                ) : null}
              </>
            ) : (
              <ChatTab
                bookId={bookId}
                entities={world.entities ?? []}
                chunkIdx={currentChunk}
                entityId={chatEntityId}
                initialMessage={chatInitialMessage}
                onSelect={(id) => {
                  setChatEntityId(id);
                  setChatInitialMessage(undefined);
                }}
                onBack={() => setChatEntityId(null)}
              />
            )}
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
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                <span className="font-display text-base">{entity.name}</span>
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
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="eyebrow -mb-px rounded-t-sm border-b-2 pb-2 transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      style={{
        borderColor: active ? "var(--world-accent)" : "transparent",
        color: active ? "var(--card-foreground)" : "var(--muted-foreground)",
      }}
    >
      {label}
    </button>
  );
}
