"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildShareUrls } from "@/components/share/ShareButton";
import { HIGHLIGHT_COLORS as HIGHLIGHT_COLOR_IDS } from "@/domain/highlights";
import { createHighlight as createHighlightRequest } from "./api";
import type { HighlightDto } from "./types";

/** The reader's highlighter palette, derived from the canonical color list
 * in src/domain/highlights.ts — see the `--highlight-*` tokens in
 * globals.css (semantic aliases onto the existing EX LIBRIS palette). */
export const HIGHLIGHT_COLORS = HIGHLIGHT_COLOR_IDS.map((id) => ({
  id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
}));

interface SelectionPopoverProps {
  /** Only selections whose range lives inside this element open the popover
   * — keeps header buttons, the world rail, etc. from ever triggering it. */
  textContainerRef: React.RefObject<HTMLElement | null>;
  /** The reader's scrollable viewport — scrolling it dismisses the popover
   * rather than leaving it anchored to a now-stale position. */
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  bookId: string;
  bookTitle: string;
  bookAuthor?: string | null;
  /** The chunk currently on screen — every highlight/note created from this
   * popover is stamped with it (the page the reader is actually looking at,
   * not necessarily where a stale selection range might drift to). */
  chunkIdx: number;
  /** Fired once a highlight (with or without a note) is created, so the
   * Reader can append it to its in-memory list without a re-fetch. */
  onHighlightCreated: (highlight: HighlightDto) => void;
}

type Selection = { text: string; rect: DOMRect };
type Mode = "actions" | "define" | "wiki" | "highlight" | "note";

type DefinitionEntry = { partOfSpeech: string; definition: string };
type LookupState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error" }
  | ({ status: "ready" } & T);

const POPOVER_WIDTH = 288; // matches w-72
const POPOVER_MARGIN = 8;

/** First alphabetic "word" of a selection — the Free Dictionary API only
 * knows single words, so a multi-word selection defines its first word. */
function firstWord(text: string): string {
  const m = text.trim().match(/[A-Za-z][A-Za-z'-]*/);
  return m ? m[0] : "";
}

async function fetchDefinition(
  term: string,
): Promise<LookupState<{ word: string; entries: DefinitionEntry[] }>> {
  const word = firstWord(term);
  if (!word) return { status: "empty" };
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
    );
    if (res.status === 404) return { status: "empty" };
    if (!res.ok) return { status: "error" };
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return { status: "empty" };
    const first = data[0] as {
      word?: string;
      meanings?: {
        partOfSpeech?: string;
        definitions?: { definition?: string }[];
      }[];
    };
    const entries: DefinitionEntry[] = [];
    for (const meaning of first.meanings ?? []) {
      for (const def of meaning.definitions ?? []) {
        if (!def.definition) continue;
        entries.push({
          partOfSpeech: meaning.partOfSpeech ?? "",
          definition: def.definition,
        });
        if (entries.length >= 3) break;
      }
      if (entries.length >= 3) break;
    }
    if (entries.length === 0) return { status: "empty" };
    return { status: "ready", word: first.word ?? word, entries };
  } catch {
    return { status: "error" };
  }
}

async function fetchWikiSummary(
  term: string,
): Promise<LookupState<{ title: string; extract: string; url?: string }>> {
  const title = term.trim().replace(/\s+/g, "_");
  if (!title) return { status: "empty" };
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { Accept: "application/json" } },
    );
    if (res.status === 404) return { status: "empty" };
    if (!res.ok) return { status: "error" };
    const data: unknown = await res.json();
    const d = data as {
      title?: string;
      extract?: string;
      type?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    if (!d.extract) return { status: "empty" };
    return {
      status: "ready",
      title: d.title ?? term,
      extract: d.extract,
      url: d.content_urls?.desktop?.page,
    };
  } catch {
    return { status: "error" };
  }
}

/**
 * Text-selection lookup popover for the reading column: Define (Free
 * Dictionary API), Wikipedia (Wikimedia REST summary), and Share quote. All
 * three are free, keyless, CORS-enabled, client-side fetches — no server
 * route, no API key, no per-lookup cost — distinct from Story Worlds' own
 * Discoveries/Codex, which stays the answer for in-fiction entities.
 *
 * Works with both mouse drag-select and mobile tap-and-hold selection via
 * the `selectionchange` event (fires for both); dismisses on Escape, an
 * outside tap, or scrolling the reader.
 */
export function SelectionPopover({
  textContainerRef,
  scrollContainerRef,
  bookId,
  bookTitle,
  bookAuthor,
  chunkIdx,
  onHighlightCreated,
}: SelectionPopoverProps) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mode, setMode] = useState<Mode>("actions");
  const [defineState, setDefineState] = useState<
    LookupState<{ word: string; entries: DefinitionEntry[] }>
  >({ status: "idle" });
  const [wikiState, setWikiState] = useState<
    LookupState<{ title: string; extract: string; url?: string }>
  >({ status: "idle" });
  const [shareState, setShareState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [origin, setOrigin] = useState("");
  const [highlightSaving, setHighlightSaving] = useState(false);
  const [highlightError, setHighlightError] = useState(false);
  const [noteText, setNoteText] = useState("");

  const popoverRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  // Focus the note textarea the moment its panel opens — a deliberate
  // imperative focus move on mode change, not state derivation.
  useEffect(() => {
    if (mode === "note") noteInputRef.current?.focus();
  }, [mode]);

  // Origin is only known client-side — read after mount, same convention as
  // ShareButton (avoids an SSR/client markup mismatch).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount hydration (window.location is browser-only)
    setOrigin(window.location.origin);
  }, []);

  const captureSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const container = textContainerRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setSelection(null);
      return;
    }
    setSelection({ text, rect });
    setMode("actions");
    setDefineState({ status: "idle" });
    setWikiState({ status: "idle" });
    setShareState("idle");
    setHighlightSaving(false);
    setHighlightError(false);
    setNoteText("");
  }, [textContainerRef]);

  useEffect(() => {
    function onSelectionChange() {
      // Selection fires rapidly mid-drag (and repeatedly during a touch
      // long-press); settle for a beat before reading the range/rect.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(captureSelection, 120);
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [captureSelection]);

  // Dismiss on outside tap (but not on a tap that starts a new in-text
  // selection — selectionchange handles updating/clearing that case).
  useEffect(() => {
    if (!selection) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (textContainerRef.current?.contains(target)) return;
      setSelection(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setSelection(null);
        window.getSelection()?.removeAllRanges();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selection, textContainerRef]);

  // Dismiss on scroll — the anchored position would otherwise go stale.
  useEffect(() => {
    if (!selection) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    function onScroll() {
      setSelection(null);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [selection, scrollContainerRef]);

  async function handleDefine() {
    if (!selection) return;
    setMode("define");
    setDefineState({ status: "loading" });
    const result = await fetchDefinition(selection.text);
    setDefineState(result);
  }

  async function handleWiki() {
    if (!selection) return;
    setMode("wiki");
    setWikiState({ status: "loading" });
    const result = await fetchWikiSummary(selection.text);
    setWikiState(result);
  }

  /** Creates a highlight in `color` with no note — the quick "Highlight" path. */
  async function handleHighlight(color: string) {
    if (!selection || highlightSaving) return;
    setHighlightSaving(true);
    setHighlightError(false);
    try {
      const { highlight } = await createHighlightRequest(bookId, {
        chunkIdx,
        text: selection.text,
        color,
      });
      onHighlightCreated(highlight);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch {
      setHighlightError(true);
    } finally {
      setHighlightSaving(false);
    }
  }

  /** Creates a highlight (default yellow) with the note text attached. */
  async function handleSaveNote() {
    if (!selection || highlightSaving) return;
    const note = noteText.trim();
    if (!note) return;
    setHighlightSaving(true);
    setHighlightError(false);
    try {
      const { highlight } = await createHighlightRequest(bookId, {
        chunkIdx,
        text: selection.text,
        note,
      });
      onHighlightCreated(highlight);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch {
      setHighlightError(true);
    } finally {
      setHighlightSaving(false);
    }
  }

  function quoteShareUrls() {
    if (!selection || !origin) return null;
    return buildShareUrls(
      {
        kind: "quote",
        bookId,
        title: bookTitle,
        author: bookAuthor,
        quote: selection.text,
      },
      origin,
    );
  }

  async function handleCopyQuote() {
    const urls = quoteShareUrls();
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(
        `${urls.shareText}\n${urls.shareUrl}`,
      );
      setShareState("copied");
    } catch {
      setShareState("error");
    }
    setTimeout(() => setShareState("idle"), 2000);
  }

  async function handleNativeShare() {
    const urls = quoteShareUrls();
    if (!urls) return;
    try {
      await navigator.share({ text: urls.shareText, url: urls.shareUrl });
    } catch {
      // AbortError (cancelled) or unsupported — the panel just stays open.
    }
  }

  if (!selection) return null;

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  // Anchor below the selection by default; flip above it if there isn't
  // room. Clamped horizontally within the viewport with a small margin.
  const estHeight = 220;
  const top =
    selection.rect.bottom + estHeight + POPOVER_MARGIN <= window.innerHeight
      ? selection.rect.bottom + POPOVER_MARGIN
      : Math.max(
          POPOVER_MARGIN,
          selection.rect.top - estHeight - POPOVER_MARGIN,
        );
  const left = Math.max(
    POPOVER_MARGIN,
    Math.min(
      selection.rect.left + selection.rect.width / 2 - POPOVER_WIDTH / 2,
      window.innerWidth - POPOVER_WIDTH - POPOVER_MARGIN,
    ),
  );

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Selected text"
      className="fixed z-50 w-72 max-w-[calc(100vw-1rem)] rounded-lg border p-3 shadow-xl"
      style={{
        top,
        left,
        background: "var(--card)",
        borderColor: "var(--border)",
        color: "var(--card-foreground)",
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="line-clamp-2 min-w-0 flex-1 font-reading text-sm italic opacity-80">
          &ldquo;{selection.text}&rdquo;
        </p>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setSelection(null)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          ×
        </button>
      </div>

      {mode === "actions" ? (
        <div className="flex flex-wrap gap-2">
          <ActionButton
            label="Highlight"
            onClick={() => setMode("highlight")}
          />
          <ActionButton label="Add note" onClick={() => setMode("note")} />
          <ActionButton label="Define" onClick={() => void handleDefine()} />
          <ActionButton label="Wikipedia" onClick={() => void handleWiki()} />
          {canNativeShare ? (
            <ActionButton
              label="Share…"
              onClick={() => void handleNativeShare()}
            />
          ) : null}
          <ActionButton
            label={
              shareState === "copied"
                ? "Copied!"
                : shareState === "error"
                  ? "Couldn't copy"
                  : "Share quote"
            }
            onClick={() => void handleCopyQuote()}
          />
        </div>
      ) : mode === "highlight" ? (
        <LookupPanel title="Highlight" onBack={() => setMode("actions")}>
          <div className="flex flex-wrap gap-2">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={`Highlight in ${c.label.toLowerCase()}`}
                disabled={highlightSaving}
                onClick={() => void handleHighlight(c.id)}
                className="flex h-11 min-w-11 items-center gap-2 rounded-md border px-3 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
                style={{ borderColor: "var(--border)" }}
              >
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded-full"
                  style={{ background: `var(--highlight-${c.id})` }}
                />
                {c.label}
              </button>
            ))}
          </div>
          {highlightError ? (
            <p role="alert" className="mt-2 font-ui text-xs opacity-60">
              Couldn&apos;t save that highlight. Try again in a moment.
            </p>
          ) : null}
        </LookupPanel>
      ) : mode === "note" ? (
        <LookupPanel title="Add note" onBack={() => setMode("actions")}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveNote();
            }}
            className="space-y-2"
          >
            <label htmlFor="selection-note" className="sr-only">
              Note
            </label>
            <textarea
              id="selection-note"
              ref={noteInputRef}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Your thoughts on this passage…"
              rows={3}
              className="w-full resize-none rounded-md border bg-transparent px-2 py-1.5 font-reading text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              style={{ borderColor: "var(--border)" }}
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={highlightSaving || noteText.trim().length === 0}
                className="flex min-h-11 items-center rounded-md border px-3 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
                style={{ borderColor: "var(--border)" }}
              >
                {highlightSaving ? "Saving…" : "Save note"}
              </button>
              {highlightError ? (
                <p role="alert" className="font-ui text-xs opacity-60">
                  Couldn&apos;t save. Try again.
                </p>
              ) : null}
            </div>
          </form>
        </LookupPanel>
      ) : mode === "define" ? (
        <LookupPanel title="Definition" onBack={() => setMode("actions")}>
          {defineState.status === "loading" ? (
            <LoadingLine />
          ) : defineState.status === "empty" ? (
            <p className="font-ui text-sm opacity-60">No definition found.</p>
          ) : defineState.status === "error" ? (
            <p className="font-ui text-sm opacity-60">
              Couldn&apos;t reach the dictionary. Try again in a moment.
            </p>
          ) : defineState.status === "ready" ? (
            <ul className="space-y-1.5">
              {defineState.entries.map((e, i) => (
                <li key={i} className="font-reading text-sm">
                  {e.partOfSpeech ? (
                    <span className="mr-1 font-ui text-xs italic opacity-60">
                      {e.partOfSpeech}
                    </span>
                  ) : null}
                  {e.definition}
                </li>
              ))}
            </ul>
          ) : null}
        </LookupPanel>
      ) : (
        <LookupPanel title="Wikipedia" onBack={() => setMode("actions")}>
          {wikiState.status === "loading" ? (
            <LoadingLine />
          ) : wikiState.status === "empty" ? (
            <p className="font-ui text-sm opacity-60">
              No Wikipedia article found.
            </p>
          ) : wikiState.status === "error" ? (
            <p className="font-ui text-sm opacity-60">
              Couldn&apos;t reach Wikipedia. Try again in a moment.
            </p>
          ) : wikiState.status === "ready" ? (
            <div className="space-y-2">
              <p className="font-reading text-sm">{wikiState.extract}</p>
              {wikiState.url ? (
                <a
                  href={wikiState.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block font-ui text-xs underline opacity-80 hover:opacity-100"
                >
                  Read more on Wikipedia
                </a>
              ) : null}
            </div>
          ) : null}
        </LookupPanel>
      )}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 items-center rounded-md border px-3 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      style={{ borderColor: "var(--border)" }}
    >
      {label}
    </button>
  );
}

function LookupPanel({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-2 flex min-h-11 items-center gap-1.5 font-ui text-xs opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
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
        {title}
      </button>
      {children}
    </div>
  );
}

function LoadingLine() {
  return <p className="font-ui text-sm opacity-60">Looking that up…</p>;
}
