"use client";

import { useEffect, useRef, useState } from "react";
import type { TocChapter } from "./types";

interface TocMenuProps {
  /** null while the reader's one-time /toc fetch is still in flight (see
   * Reader.tsx) — the panel shows a loading state rather than "no chapters". */
  chapters: TocChapter[] | null;
  currentChunk: number;
  totalChunks: number | null;
  /** Jumps the reader to a 0-based chunk index, reusing the same in-reader
   * navigation the `?chunk=` deep-link uses (Reader.tsx's `navigate`) — never
   * a full page reload. Jumping ahead of the reader's frontier is allowed,
   * same as Kindle: the world/Discoveries surfaces stay frontier-gated
   * server-side regardless of where the reader's cursor sits. */
  onNavigate: (chunkIdx: number) => void;
  className?: string;
}

/**
 * Header "Contents" button: a chapter jump menu sourced from the book's own
 * heading detection (src/domain/reader-format.ts's collectToc, served by
 * GET /api/books/{id}/toc), plus a plain numeric "Go to page" input. Follows
 * the same trigger/panel/Escape/outside-click convention as ReaderSettings
 * and SoundscapeControl in the same header cluster.
 */
export function TocMenu({
  chapters,
  currentChunk,
  totalChunks,
  onNavigate,
  className,
}: TocMenuProps) {
  const [open, setOpen] = useState(false);
  const [pageInput, setPageInput] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function jumpTo(chunkIdx: number) {
    onNavigate(chunkIdx);
    setOpen(false);
  }

  function handleGoToPage(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(pageInput);
    if (!Number.isFinite(n) || n < 1) return;
    jumpTo(Math.trunc(n) - 1);
    setPageInput("");
  }

  // Highlight the chapter the reader is currently inside: the last heading
  // whose chunkIdx is at or before the current position.
  const currentChapterIdx = chapters
    ? [...chapters].reverse().find((c) => c.chunkIdx <= currentChunk)?.chunkIdx
    : undefined;

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Table of contents"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 min-w-11 items-center justify-center rounded-full border px-3.5 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        style={{
          background: "var(--card)",
          borderColor: "var(--border)",
          color: "var(--card-foreground)",
        }}
      >
        <ContentsGlyph />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Table of contents"
          className="absolute top-full right-0 z-50 mt-2 flex max-h-[75vh] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border shadow-xl"
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
            color: "var(--card-foreground)",
          }}
        >
          <form
            onSubmit={handleGoToPage}
            className="flex shrink-0 items-center gap-2 border-b p-3"
            style={{ borderColor: "var(--border)" }}
          >
            <label htmlFor="toc-go-to-page" className="eyebrow shrink-0">
              Go to page
            </label>
            <input
              id="toc-go-to-page"
              type="number"
              inputMode="numeric"
              min={1}
              max={totalChunks ?? undefined}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              placeholder={totalChunks ? `1–${totalChunks}` : undefined}
              className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              style={{ borderColor: "var(--border)" }}
            />
            <button
              type="submit"
              className="flex h-9 shrink-0 items-center rounded-md border px-3 font-ui text-xs focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              style={{ borderColor: "var(--border)" }}
            >
              Go
            </button>
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {chapters == null ? (
              <p className="p-2 font-ui text-sm opacity-60">
                Reading the table of contents…
              </p>
            ) : chapters.length === 0 ? (
              <p className="p-2 font-ui text-sm opacity-60">
                No chapter headings were detected in this book.
              </p>
            ) : (
              <ol className="space-y-0.5">
                {chapters.map((c, i) => {
                  const active = c.chunkIdx === currentChapterIdx;
                  return (
                    <li key={`${c.chunkIdx}-${i}`}>
                      <button
                        type="button"
                        aria-current={active ? "true" : undefined}
                        onClick={() => jumpTo(c.chunkIdx)}
                        className="block min-h-11 w-full rounded-md px-3 py-2 text-left font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                        style={{
                          background: active ? "var(--muted)" : "transparent",
                          color: active
                            ? "var(--world-accent)"
                            : "var(--card-foreground)",
                        }}
                      >
                        {c.title}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ContentsGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12" x2="10" y2="12" />
    </svg>
  );
}
