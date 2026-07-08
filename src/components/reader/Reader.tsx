"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBook, fetchChunk, putProgress, ReaderApiError } from "./api";
import { ReaderSettings } from "./ReaderSettings";
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
  const [settings, setSettings] = useState<ReaderSettingsState>(
    DEFAULT_SETTINGS,
  );

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
        putProgress(bookId, clamped)
          .then((p) => {
            frontierRef.current = p.frontierChunk;
          })
          .catch(() => {
            // best-effort — progress will sync on next successful nav
          });
      }, PROGRESS_DEBOUNCE_MS);
    },
    [bookId, loadChunk, loadState.kind, prefetch, totalChunks],
  );

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
    idleTimer.current = setTimeout(
      () => setChromeVisible(false),
      IDLE_HIDE_MS,
    );
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
        window.location.href = "/shelf";
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev, wakeChrome]);

  useEffect(() => {
    return () => {
      if (progressTimer.current) clearTimeout(progressTimer.current);
    };
  }, []);

  const theme = themeSwatch(settings.theme);
  const family = faceFamily(settings.face);
  const ch = measureCh(settings.measure);

  const paragraphs = useMemo(() => {
    if (!chunkData) return [];
    return chunkData.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
  }, [chunkData]);

  const isEmptyChunk = chunkData != null && paragraphs.length === 0;
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
        <p className="font-ui max-w-md text-sm opacity-80">
          {loadState.message}
        </p>
        <Link
          href="/shelf"
          className="font-ui mt-2 rounded-full border px-5 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
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
      className="fixed inset-0 z-30 overflow-y-auto"
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
          className="font-ui flex min-h-11 items-center gap-1.5 rounded-md px-2 py-2 text-sm opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
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
          <p className="font-display truncate text-sm sm:text-base">
            {book?.title ?? ""}
          </p>
          {pageLabel ? <p className="eyebrow mt-0.5">{pageLabel}</p> : null}
        </div>

        <ReaderSettings settings={settings} onChange={setSettings} />
      </header>

      {/* Mobile floating cluster (shown when chrome is hidden) */}
      <div
        className={`fixed right-4 bottom-6 z-40 sm:hidden transition-[opacity,transform] duration-300 motion-reduce:transition-none ${
          chromeVisible
            ? "pointer-events-none translate-y-2 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        <ReaderSettings settings={settings} onChange={setSettings} compact />
      </div>

      {/* Click zones */}
      <button
        type="button"
        aria-label="Previous page"
        onClick={goPrev}
        className="group fixed top-0 left-0 z-20 flex h-full w-[20%] items-center justify-start pl-2 focus-visible:outline-none"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 16 16"
          fill="none"
          className="opacity-0 transition-opacity duration-150 group-hover:opacity-40"
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
        className="group fixed top-0 right-0 z-20 flex h-full w-[20%] items-center justify-end pr-2 focus-visible:outline-none"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 16 16"
          fill="none"
          className="opacity-0 transition-opacity duration-150 group-hover:opacity-40"
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
      <main className="relative z-10 mx-auto min-h-full px-6 pt-24 pb-20">
        <div
          className="mx-auto"
          style={{ maxWidth: `${ch}ch`, fontFamily: family }}
        >
          {loadState.kind === "loading" || chunkLoading || !chunkData ? (
            <ReaderSkeleton />
          ) : isEmptyChunk ? (
            <p className="font-ui py-32 text-center text-sm opacity-50">
              — blank page —
            </p>
          ) : (
            <div
              style={{
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineHeight,
              }}
              className="space-y-[1em]"
            >
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
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
          style={{ width: `${progressPct}%`, background: "var(--world-accent)" }}
        />
      </div>
    </div>
  );
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
