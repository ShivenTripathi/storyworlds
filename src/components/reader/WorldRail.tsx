"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WorldFormingCard } from "@/components/world/WorldFormingCard";
import { CastList } from "@/components/world/CastList";
import { SceneView } from "@/components/world/SceneView";
import { useJob } from "@/components/world/useJob";
import { analyzeBook, fetchWorld } from "@/components/world/api";
import type { World } from "@/components/world/types";
import type { OverlayState } from "./useOverlay";

type WorldTab = "scene" | "cast";

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
export function WorldRail({ bookId, open, onClose, currentChunk, overlay }: WorldRailProps) {
  const [world, setWorld] = useState<World | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [tab, setTab] = useState<WorldTab>("scene");
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

  if (!open) return null;

  const status = world?.status ?? "none";
  const isPending = status === "pending" || (job && (job.status === "queued" || job.status === "running"));
  const isFailed = status === "failed" || job?.status === "failed";

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="complementary"
      aria-label="Story world"
      className="fixed inset-x-0 bottom-0 z-50 h-[60vh] overflow-y-auto rounded-t-lg border-t focus:outline-none md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[340px] md:rounded-none md:border-t-0 md:border-l"
      style={{
        background: "var(--world-surface)",
        borderColor: "var(--world-frame)",
      }}
    >
      {/* Mobile drag handle (visual only) */}
      <div
        aria-hidden="true"
        className="mx-auto mt-2 h-1 w-10 rounded-full md:hidden"
        style={{ background: "var(--world-frame)" }}
      />

      <div className="flex items-center justify-between px-4 py-3">
        <p className="eyebrow">THE WORLD</p>
        <button
          type="button"
          aria-label="Close world panel"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-lg opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          ×
        </button>
      </div>

      {loaded && status === "completed" && world ? (
        <div className="flex items-center gap-4 border-b px-4 pb-2" style={{ borderColor: "var(--world-frame)" }}>
          <TabButton label="Scene" active={tab === "scene"} onClick={() => setTab("scene")} />
          <TabButton label="Cast" active={tab === "cast"} onClick={() => setTab("cast")} />
        </div>
      ) : null}

      <div className="px-4 pb-8 pt-4">
        {!loaded ? (
          <p className="font-ui text-sm text-muted-foreground">Opening the world…</p>
        ) : status === "completed" && world ? (
          <div className="space-y-6">
            {tab === "scene" ? (
              <SceneView bookId={bookId} chunkIdx={currentChunk} preloaded={overlay} />
            ) : (
              <>
                {world.settingDescription ? (
                  <p className="font-reading text-sm leading-relaxed">{world.settingDescription}</p>
                ) : null}
                {world.entities && world.entities.length > 0 ? (
                  <CastList entities={world.entities} counts={world.counts} />
                ) : null}
              </>
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
              className="font-ui rounded-full bg-[var(--world-accent)] px-4 py-2 text-xs font-medium text-[var(--world-accent-fg)] transition-opacity hover:opacity-90"
            >
              Awaken the world
            </button>
          </div>
        )}
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
      className="eyebrow -mb-px border-b-2 pb-2 transition-colors"
      style={{
        borderColor: active ? "var(--world-accent)" : "transparent",
        color: active ? "var(--card-foreground)" : undefined,
      }}
    >
      {label}
    </button>
  );
}
