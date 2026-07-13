"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  deleteBookmark as deleteBookmarkRequest,
  deleteHighlight as deleteHighlightRequest,
  searchBook as searchBookRequest,
} from "./api";
import type { BookmarkDto, HighlightDto, SearchHit } from "./types";

type Tab = "bookmarks" | "notes" | "search";

interface NotebookMenuProps {
  bookId: string;
  bookTitle: string;
  bookmarks: BookmarkDto[];
  highlights: HighlightDto[];
  /** Jumps the reader to a 0-based chunk index — same in-reader navigation
   * TocMenu uses (Reader.tsx's `navigate`), never a full page reload. */
  onNavigate: (chunkIdx: number) => void;
  onBookmarkDeleted: (id: string) => void;
  onHighlightDeleted: (id: string) => void;
  className?: string;
}

/** Serializes highlights (+ notes) and bookmarks to Markdown for the
 * "export notes" download — grouped by page, in reading order. */
function exportMarkdown(
  bookTitle: string,
  highlights: HighlightDto[],
  bookmarks: BookmarkDto[],
): string {
  const lines = [`# Notes — ${bookTitle}`, ""];

  if (bookmarks.length > 0) {
    lines.push("## Bookmarks", "");
    for (const b of [...bookmarks].sort((a, b) => a.chunkIdx - b.chunkIdx)) {
      lines.push(`- Page ${b.chunkIdx + 1}${b.label ? ` — ${b.label}` : ""}`);
    }
    lines.push("");
  }

  if (highlights.length > 0) {
    lines.push("## Highlights & notes", "");
    for (const h of [...highlights].sort((a, b) => a.chunkIdx - b.chunkIdx)) {
      lines.push(`> ${h.text.replace(/\n+/g, " ")}`);
      lines.push(`— Page ${h.chunkIdx + 1} (${h.color})`);
      if (h.note) lines.push(`\nNote: ${h.note}`);
      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Header "Notebook" button: bookmarks, highlights & notes, and an in-book
 * search — all frontier-safe, all the reader's own private data. Same
 * trigger/panel/Escape/outside-click convention as TocMenu and
 * SoundscapeControl in the same header cluster.
 */
export function NotebookMenu({
  bookId,
  bookTitle,
  bookmarks,
  highlights,
  onNavigate,
  onBookmarkDeleted,
  onHighlightDeleted,
  className,
}: NotebookMenuProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; results: SearchHit[] }
  >({ status: "idle" });
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

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      setSearchState({ status: "idle" });
      return;
    }
    setSearchState({ status: "loading" });
    try {
      const { results } = await searchBookRequest(bookId, q);
      setSearchState({ status: "ready", results });
    } catch {
      setSearchState({ status: "error" });
    }
  }

  async function handleDeleteBookmark(id: string) {
    try {
      await deleteBookmarkRequest(bookId, id);
      onBookmarkDeleted(id);
    } catch {
      // best-effort — the row simply stays in the list to retry
    }
  }

  async function handleDeleteHighlight(id: string) {
    try {
      await deleteHighlightRequest(bookId, id);
      onHighlightDeleted(id);
    } catch {
      // best-effort — the row simply stays in the list to retry
    }
  }

  const sortedBookmarks = [...bookmarks].sort(
    (a, b) => a.chunkIdx - b.chunkIdx,
  );
  const sortedHighlights = [...highlights].sort(
    (a, b) => a.chunkIdx - b.chunkIdx,
  );

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Notebook: bookmarks, highlights, notes, and search"
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
        <NotebookGlyph />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notebook"
          className="absolute top-full right-0 z-50 mt-2 flex max-h-[75vh] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border shadow-xl"
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
            color: "var(--card-foreground)",
          }}
        >
          <div
            role="tablist"
            aria-label="Notebook sections"
            className="flex shrink-0 items-center gap-1 border-b p-2"
            style={{ borderColor: "var(--border)" }}
          >
            {(
              [
                { id: "search", label: "Search" },
                { id: "bookmarks", label: "Bookmarks" },
                { id: "notes", label: "Notes" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className="min-h-9 flex-1 rounded-md px-2 py-1.5 font-ui text-xs focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                style={{
                  background: tab === t.id ? "var(--muted)" : "transparent",
                  color:
                    tab === t.id
                      ? "var(--world-accent)"
                      : "var(--card-foreground)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "search" ? (
              <div className="space-y-3">
                <form
                  onSubmit={(e) => void handleSearch(e)}
                  className="flex gap-2"
                >
                  <label htmlFor="notebook-search-q" className="sr-only">
                    Search this book
                  </label>
                  <input
                    id="notebook-search-q"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search what you've read…"
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
                <p className="font-ui text-xs opacity-50">
                  Only searches pages you&apos;ve already read — no spoilers.
                </p>
                {searchState.status === "loading" ? (
                  <p className="font-ui text-sm opacity-60">Searching…</p>
                ) : searchState.status === "error" ? (
                  <p role="alert" className="font-ui text-sm opacity-60">
                    Couldn&apos;t search right now. Try again in a moment.
                  </p>
                ) : searchState.status === "ready" ? (
                  searchState.results.length === 0 ? (
                    <p className="font-ui text-sm opacity-60">
                      No matches in what you&apos;ve read so far.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {searchState.results.map((hit, i) => (
                        <li key={`${hit.chunkIdx}-${i}`}>
                          <button
                            type="button"
                            onClick={() => jumpTo(hit.chunkIdx)}
                            className="block w-full rounded-md px-2 py-2 text-left hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                          >
                            <span className="eyebrow block">
                              Page {hit.pageNumber ?? hit.chunkIdx + 1}
                            </span>
                            <span className="mt-0.5 block font-reading text-sm">
                              {hit.snippet.slice(0, hit.matchStart)}
                              <mark
                                className="rounded-sm"
                                style={{
                                  background:
                                    "color-mix(in srgb, var(--highlight-yellow) 45%, transparent)",
                                }}
                              >
                                {hit.snippet.slice(
                                  hit.matchStart,
                                  hit.matchStart + hit.matchLength,
                                )}
                              </mark>
                              {hit.snippet.slice(
                                hit.matchStart + hit.matchLength,
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </div>
            ) : tab === "bookmarks" ? (
              sortedBookmarks.length === 0 ? (
                <p className="font-ui text-sm opacity-60">
                  No bookmarks yet — use the bookmark button in the header to
                  save a page.
                </p>
              ) : (
                <ul className="space-y-1">
                  {sortedBookmarks.map((b) => (
                    <li key={b.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => jumpTo(b.chunkIdx)}
                        className="min-h-11 flex-1 rounded-md px-2 py-2 text-left font-ui text-sm hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                      >
                        Page {b.chunkIdx + 1}
                        {b.label ? ` — ${b.label}` : ""}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove bookmark on page ${b.chunkIdx + 1}`}
                        onClick={() => void handleDeleteBookmark(b.id)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm opacity-60 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : sortedHighlights.length === 0 ? (
              <p className="font-ui text-sm opacity-60">
                No highlights yet — select text while reading to highlight or
                add a note.
              </p>
            ) : (
              <>
                <ul className="space-y-2">
                  {sortedHighlights.map((h) => (
                    <li key={h.id}>
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => jumpTo(h.chunkIdx)}
                          className="min-h-11 min-w-0 flex-1 rounded-md px-2 py-2 text-left hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                        >
                          <span className="eyebrow flex items-center gap-1.5">
                            <span
                              aria-hidden="true"
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{
                                background: `var(--highlight-${h.color})`,
                              }}
                            />
                            Page {h.chunkIdx + 1}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block font-reading text-sm italic opacity-90">
                            &ldquo;{h.text}&rdquo;
                          </span>
                          {h.note ? (
                            <span className="mt-0.5 line-clamp-2 block font-ui text-xs opacity-70">
                              {h.note}
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          aria-label="Remove highlight"
                          onClick={() => void handleDeleteHighlight(h.id)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm opacity-60 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      `${bookTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-notes.md`,
                      exportMarkdown(bookTitle, highlights, bookmarks),
                    )
                  }
                  className="mt-3 flex min-h-11 w-full items-center justify-center rounded-md border font-ui text-xs focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  style={{ borderColor: "var(--border)" }}
                >
                  Export notes (.md)
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotebookGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 1.5h7.5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 4 1.5z" />
      <path d="M3 3.5h9.5" />
      <path d="M6 6.5h4M6 9h4" />
    </svg>
  );
}
