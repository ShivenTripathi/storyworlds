"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchBook,
  fetchChunk,
  putProgress,
  progressRequest,
  ReaderApiError,
} from "./api";
import { ChapterPlate } from "./ChapterPlate";
import { ReaderSettings } from "./ReaderSettings";
import { useOverlay } from "./useOverlay";
import { WorldRail } from "./WorldRail";
import {
  DEFAULT_SETTINGS,
  faceFamily,
  loadReaderSettings,
  measureCh,
  saveReaderSettings,
  themeSwatch,
  type ReaderSettingsState,
} from "./settings";
import type { BookSummary, ChunkPayload } from "./types";
import {
  formatChunk,
  splitDropCap,
  type Block,
  type TextRun,
} from "@/domain/reader-format";

const IDLE_HIDE_MS = 2500;
const PROGRESS_DEBOUNCE_MS = 800;

interface ReaderProps {
  bookId: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; status: number; message: string }
  | { kind: "ready" };

export function Reader({ bookId }: ReaderProps) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [book, setBook] = useState<BookSummary | null>(null);
  const [currentChunk, setCurrentChunk] = useState(0);
  const [chunkData, setChunkData] = useState<ChunkPayload | null>(null);
  const [chunkLoading, setChunkLoading] = useState(true);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [railOpen, setRailOpen] = useState(false);
  const [settings, setSettings] =
    useState<ReaderSettingsState>(DEFAULT_SETTINGS);

  // Only start fetching the scene overlay once this page's text has settled
  // on screen for a beat — avoids firing a request for every page flown past
  // while paging quickly.
  const [overlayEnabled, setOverlayEnabled] = useState(false);

  // Lazily fetches (and polls for) the current page's scene overlay — shared
  // by the inline ChapterPlate below and, via prop, WorldRail's Scene tab,
  // so the two never double-fetch the same page.
  const { state: overlayState } = useOverlay(bookId, currentChunk, {
    enabled: overlayEnabled,
  });

  // Hydrate persisted settings after mount — localStorage isn't available
  // during SSR, so initializing state here (rather than lazily in
  // useState) avoids a server/client markup mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount hydration, see comment above
    setSettings(loadReaderSettings());
  }, []);

  useEffect(() => {
    saveReaderSettings(settings);
  }, [settings]);

  // Arm the overlay fetch ~300ms after the current chunk's text is on
  // screen — a deliberate delayed sync with a UI timer, not state derived
  // from props/state already in React.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    setOverlayEnabled(false);
    if (chunkLoading || !chunkData) return;
    const t = setTimeout(() => setOverlayEnabled(true), 300);
    return () => clearTimeout(t);
  }, [currentChunk, chunkLoading, chunkData]);

  // Background chunk cache, keyed by chunk index. Only ever read/written
  // from callbacks (never during render) so it stays outside React's
  // render-purity rules; the chunk actually on screen is mirrored into
  // `chunkData` state above.
  const cacheRef = useRef<Map<number, ChunkPayload>>(new Map());
  const frontierRef = useRef(0);
  const requestSeq = useRef(0);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Latest on-screen position + a "has unsaved turns" flag, both read by
  // flushProgress() from stale closures (unmount cleanup, pagehide) where
  // reading React state directly would be stale.
  const latestChunkRef = useRef(0);
  const progressDirtyRef = useRef(false);

  const totalChunks = chunkData?.totalChunks ?? book?.totalChunks ?? null;

  const prefetch = useCallback(
    (idx: number) => {
      if (idx < 0 || cacheRef.current.has(idx)) return;
      void fetchChunk(bookId, idx)
        .then((data) => cacheRef.current.set(idx, data))
        .catch(() => {
          // best-effort prefetch — a real navigation will retry
        });
    },
    [bookId],
  );

  const loadChunk = useCallback(
    async (idx: number, seq: number) => {
      let data = cacheRef.current.get(idx);
      if (!data) {
        data = await fetchChunk(bookId, idx);
        cacheRef.current.set(idx, data);
      }
      if (requestSeq.current === seq) {
        setChunkData(data);
        setChunkLoading(false);
      }
      return data;
    },
    [bookId],
  );

  // Initial load: book metadata + progress, then the starting chunk.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadState({ kind: "loading" });
      try {
        const { book: b, progress } = await fetchBook(bookId);
        if (cancelled) return;
        setBook(b);
        const start = Math.max(0, progress?.currentChunk ?? 0);
        frontierRef.current = progress?.frontierChunk ?? start;
        latestChunkRef.current = start;
        setCurrentChunk(start);

        const seq = ++requestSeq.current;
        setChunkLoading(true);
        await loadChunk(start, seq);
        if (cancelled) return;
        setLoadState({ kind: "ready" });

        prefetch(start + 1);
        prefetch(start - 1);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ReaderApiError) {
          setLoadState({
            kind: "error",
            status: err.status,
            message: err.message,
          });
        } else {
          setLoadState({
            kind: "error",
            status: 0,
            message: "Something went wrong loading this book.",
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per bookId; loadChunk/prefetch are stable for a given bookId
  }, [bookId]);

  const navigate = useCallback(
    (nextIdx: number) => {
      if (loadState.kind !== "ready") return;
      const max = totalChunks != null ? totalChunks - 1 : nextIdx;
      const clamped = Math.min(Math.max(0, nextIdx), Math.max(0, max));

      const seq = ++requestSeq.current;
      setCurrentChunk(clamped);
      latestChunkRef.current = clamped;
      progressDirtyRef.current = true;
      frontierRef.current = Math.max(frontierRef.current, clamped);
      containerRef.current?.scrollTo({ top: 0, behavior: "auto" });

      if (cacheRef.current.has(clamped)) {
        setChunkData(cacheRef.current.get(clamped) ?? null);
        setChunkLoading(false);
      } else {
        setChunkLoading(true);
        void loadChunk(clamped, seq);
      }

      prefetch(clamped + 1);
      prefetch(clamped - 1);

      if (progressTimer.current) clearTimeout(progressTimer.current);
      progressTimer.current = setTimeout(() => {
        progressTimer.current = null;
        putProgress(bookId, clamped, frontierRef.current)
          .then((p) => {
            frontierRef.current = p.frontierChunk;
            // Only clears the flag if no newer turn dirtied it while this
            // request was in flight.
            if (latestChunkRef.current === clamped) {
              progressDirtyRef.current = false;
            }
          })
          .catch(() => {
            // best-effort — progress will sync on next successful nav/flush
          });
      }, PROGRESS_DEBOUNCE_MS);
    },
    [bookId, loadChunk, loadState.kind, prefetch, totalChunks],
  );

  // Immediately persist the latest position, cancelling any pending debounce.
  // Uses a `keepalive` fetch so it survives the page tearing down (tab close,
  // full navigation on Escape/Shelf). Idempotent + server-clamped, so a
  // redundant flush is harmless; guarded by the dirty flag to skip no-op
  // writes when nothing has changed since the last successful save.
  const flushProgress = useCallback(() => {
    if (progressTimer.current) {
      clearTimeout(progressTimer.current);
      progressTimer.current = null;
    }
    if (!progressDirtyRef.current) return;
    progressDirtyRef.current = false;
    const { url, body } = progressRequest(
      bookId,
      latestChunkRef.current,
      frontierRef.current,
    );
    try {
      void fetch(url, {
        method: "PUT",
        keepalive: true,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch {
      // best-effort — nothing more we can do as the page tears down
    }
  }, [bookId]);

  const goNext = useCallback(
    () => navigate(currentChunk + 1),
    [navigate, currentChunk],
  );
  const goPrev = useCallback(
    () => navigate(currentChunk - 1),
    [navigate, currentChunk],
  );

  // Auto-hiding chrome
  const wakeChrome = useCallback(() => {
    setChromeVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setChromeVisible(false), IDLE_HIDE_MS);
  }, []);

  useEffect(() => {
    // Show chrome on mount and start its idle-hide countdown; this is a
    // deliberate sync between the effect lifecycle and a UI timer, not
    // state derivation, so we opt out of the setState-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    wakeChrome();
    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "touchstart",
      "pointerdown",
    ];
    events.forEach((ev) => window.addEventListener(ev, wakeChrome));
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, wakeChrome));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [wakeChrome]);

  // Keyboard navigation
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      }
      if (e.key === "ArrowRight") {
        wakeChrome();
        goNext();
      } else if (e.key === "ArrowLeft") {
        wakeChrome();
        goPrev();
      } else if (e.key === "Escape") {
        if (railOpen) {
          e.stopPropagation();
          setRailOpen(false);
        } else {
          // Full-page nav would abort an in-flight debounced save — persist
          // the last turn first.
          flushProgress();
          window.location.href = "/shelf";
        }
      } else if (e.key === "w" || e.key === "W") {
        wakeChrome();
        setRailOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev, railOpen, wakeChrome, flushProgress]);

  // Persist reading progress across every teardown path: React unmount
  // (Shelf link, route change), tab close / navigation (pagehide), and
  // backgrounding (visibilitychange → hidden). Each flushes the pending
  // debounce so the last page turn(s) are never lost.
  useEffect(() => {
    function onPageHide() {
      flushProgress();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") flushProgress();
    }
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushProgress();
    };
  }, [flushProgress]);

  const theme = themeSwatch(settings.theme);
  const family = faceFamily(settings.face);
  const ch = measureCh(settings.measure);

  const blocks = useMemo(
    () => (chunkData ? formatChunk(chunkData.text) : []),
    [chunkData],
  );

  const isEmptyChunk = chunkData != null && blocks.length === 0;

  // Two-column "spread" only kicks in when the page actually has enough text
  // to fill both columns — otherwise a short chunk balances into two
  // half-empty columns with a big blank gutter. Below the threshold we fall
  // back to a single column so it always reads like a real page.
  const SPREAD_MIN_CHARS = 1200;
  const useSpread =
    settings.pageView === "spread" &&
    (chunkData?.text.length ?? 0) >= SPREAD_MIN_CHARS;
  const pageLabel =
    chunkData && totalChunks
      ? `Page ${currentChunk + 1} of ${totalChunks} · ${Math.round(
          ((currentChunk + 1) / totalChunks) * 100,
        )}%`
      : null;

  const progressPct =
    totalChunks && totalChunks > 0
      ? Math.min(100, ((currentChunk + 1) / totalChunks) * 100)
      : 0;

  if (loadState.kind === "error") {
    const isAuthError = loadState.status === 401;
    const isNotFound = loadState.status === 404;
    return (
      <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="eyebrow">
          {isAuthError
            ? "Sign-in required"
            : isNotFound
              ? "Book not found"
              : "Something went wrong"}
        </p>
        <p className="max-w-md font-ui text-sm opacity-80">
          {loadState.message}
        </p>
        <Link
          href="/shelf"
          className="mt-2 rounded-full border px-5 py-2 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          style={{ borderColor: "var(--border)" }}
        >
          Back to Shelf
        </Link>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-world-theme={book?.themeArchetype ?? undefined}
      className="fixed inset-0 z-30 overflow-x-hidden overflow-y-auto"
      style={
        {
          "--reader-bg": theme.bg,
          "--reader-fg": theme.fg,
          background: "var(--reader-bg)",
          color: "var(--reader-fg)",
        } as React.CSSProperties
      }
    >
      {/* Chrome: top bar */}
      <header
        className={`fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur transition-[opacity,transform] duration-300 motion-reduce:transition-none sm:px-6 ${
          chromeVisible
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0"
        }`}
        style={{
          background: "color-mix(in srgb, var(--reader-bg) 88%, transparent)",
          borderColor: "var(--world-frame, var(--border))",
        }}
      >
        <Link
          href="/shelf"
          aria-label="Back to Shelf"
          className="flex min-h-11 items-center gap-1.5 rounded-md px-2 py-2 font-ui text-sm opacity-80 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          <svg
            width="16"
            height="16"
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
          Shelf
        </Link>

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-display text-sm sm:text-base">
            {book?.title ?? ""}
          </p>
          {pageLabel ? <p className="eyebrow mt-0.5">{pageLabel}</p> : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Toggle story world panel"
            aria-pressed={railOpen}
            onClick={() => setRailOpen((v) => !v)}
            className="flex h-11 min-w-11 items-center justify-center rounded-full border px-3.5 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            style={{
              background: "var(--card)",
              borderColor: "var(--border)",
              color: "var(--card-foreground)",
            }}
          >
            World
          </button>
          <ReaderSettings settings={settings} onChange={setSettings} />
        </div>
      </header>

      {/* Page-turn tap zones. Chevrons are a persistent affordance whenever the
          chrome is visible (so touch users — who have no hover — always see
          them), and additionally brighten on hover for pointer users. The
          zones are narrow on phones and sit inside the reading column's side
          padding so they never eat the text. */}
      <button
        type="button"
        aria-label="Previous page"
        onClick={goPrev}
        className="group fixed top-0 left-0 z-20 flex h-full w-11 items-center justify-start pl-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none focus-visible:ring-inset sm:w-[12%] sm:max-w-16"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 16 16"
          fill="none"
          className={`transition-opacity duration-200 group-hover:opacity-60 ${
            chromeVisible ? "opacity-35" : "opacity-0"
          }`}
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
      </button>
      <button
        type="button"
        aria-label="Next page"
        onClick={goNext}
        className="group fixed top-0 right-0 z-20 flex h-full w-11 items-center justify-end pr-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none focus-visible:ring-inset sm:w-[12%] sm:max-w-16"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 16 16"
          fill="none"
          className={`transition-opacity duration-200 group-hover:opacity-60 ${
            chromeVisible ? "opacity-35" : "opacity-0"
          }`}
          aria-hidden="true"
        >
          <path
            d="M6 3l5 5-5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Text column */}
      <main
        className={`relative z-10 mx-auto min-h-full px-12 pt-24 pb-20 transition-[padding] duration-300 motion-reduce:transition-none sm:px-6 ${
          railOpen ? "md:pr-[340px]" : ""
        }`}
      >
        <div
          className="mx-auto"
          style={{
            // A spread flows into two columns, so it needs ~2× the single-page
            // measure plus a gutter.
            maxWidth: useSpread ? `${ch * 2 + 8}ch` : `${ch}ch`,
            fontFamily: family,
          }}
        >
          {loadState.kind === "loading" || chunkLoading || !chunkData ? (
            <ReaderSkeleton />
          ) : isEmptyChunk ? (
            <p className="py-32 text-center font-ui text-sm opacity-50">
              — blank page —
            </p>
          ) : (
            <>
              {overlayState.status === "ready" &&
              overlayState.overlay.imageUrl &&
              !overlayState.overlay.imageIsForwardFill ? (
                <ChapterPlate overlay={overlayState.overlay} />
              ) : null}
              <div
                style={{
                  fontSize: `${settings.fontSize}px`,
                  lineHeight: settings.lineHeight,
                }}
                className={
                  useSpread
                    ? "reader-prose reader-prose--spread"
                    : "reader-prose"
                }
              >
                {blocks.map((block, i) => (
                  <ReaderBlock key={i} block={block} />
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Progress filament */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 h-[2px]"
        style={{ background: "var(--world-frame, var(--border))" }}
      >
        <div
          className="h-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{
            width: `${progressPct}%`,
            background: "var(--world-accent)",
          }}
        />
      </div>

      <WorldRail
        bookId={bookId}
        open={railOpen}
        onClose={() => setRailOpen(false)}
        currentChunk={currentChunk}
        overlay={overlayState}
      />
    </div>
  );
}

/** Renders a run list, honouring italic spans (from Gutenberg `_..._`). */
function Runs({ runs }: { runs: TextRun[] }) {
  return (
    <>
      {runs.map((r, i) =>
        r.italic ? <em key={i}>{r.text}</em> : <span key={i}>{r.text}</span>,
      )}
    </>
  );
}

/** One typographic block of the reading column. */
function ReaderBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "display":
      return (
        <p
          className={
            block.level === "title" ? "reader-display-title" : "reader-display"
          }
        >
          {block.text}
        </p>
      );
    case "heading":
      return (
        <h2 className={block.section ? "reader-section" : "reader-chapter"}>
          {block.text}
        </h2>
      );
    case "toc":
      return (
        <nav className="reader-toc" aria-label="Contents">
          <ol>
            {block.entries.map((e, i) => (
              <li key={i}>
                <span className="reader-toc-marker">{e.marker}</span>
                <span className="reader-toc-title">{e.title}</span>
              </li>
            ))}
          </ol>
        </nav>
      );
    case "illustration":
      return (
        <figure className="reader-ornament" aria-hidden="true">
          <span className="reader-ornament-mark">❧</span>
        </figure>
      );
    case "para": {
      if (block.dropCap) {
        const split = splitDropCap(block.runs);
        if (split) {
          return (
            <p className="reader-para">
              <span className="reader-dropcap">{split.cap}</span>
              <Runs runs={split.rest} />
            </p>
          );
        }
      }
      return (
        <p className="reader-para">
          <Runs runs={block.runs} />
        </p>
      );
    }
  }
}

function ReaderSkeleton() {
  return (
    <div className="animate-pulse space-y-4 pt-4" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded"
          style={{
            background: "var(--muted)",
            width: i % 3 === 2 ? "70%" : "100%",
          }}
        />
      ))}
    </div>
  );
}
