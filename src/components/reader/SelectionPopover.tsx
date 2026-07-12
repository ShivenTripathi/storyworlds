"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildShareUrls } from "@/components/share/ShareButton";

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
}

type Selection = { text: string; rect: DOMRect };
type Mode = "actions" | "define" | "wiki";

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

  const popoverRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
