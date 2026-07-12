"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HIGHLIGHT_COLORS } from "./SelectionPopover";
import {
  deleteHighlight as deleteHighlightRequest,
  updateHighlight as updateHighlightRequest,
} from "./api";
import type { HighlightDto } from "./types";

interface HighlightEditorProps {
  bookId: string;
  /** The highlight being edited, and the rect of the `<mark>` the reader
   * clicked (used to anchor the popover) — null closes it. */
  target: { highlight: HighlightDto; rect: DOMRect } | null;
  onClose: () => void;
  onUpdated: (highlight: HighlightDto) => void;
  onDeleted: (id: string) => void;
}

const POPOVER_WIDTH = 272;
const POPOVER_MARGIN = 8;

/**
 * The popover opened by clicking one of the reader's own highlighted marks
 * in the running text: change its color, add/edit its note, or remove it
 * entirely. Visually and behaviorally a sibling of `SelectionPopover`
 * (same anchoring math, same dismiss-on-Escape/outside-tap/scroll
 * conventions) but keyed to an existing highlight rather than a live
 * selection.
 */
export function HighlightEditor({
  bookId,
  target,
  onClose,
  onUpdated,
  onDeleted,
}: HighlightEditorProps) {
  const [note, setNote] = useState(target?.highlight.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Reset local note draft whenever a different highlight is opened — a
  // deliberate sync of external state (which highlight is targeted) into
  // local edit-draft state, not a derivation of state already in React.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync on target change, see comment above
    setNote(target?.highlight.note ?? "");

    setError(false);
  }, [target?.highlight.id, target?.highlight.note]);

  const close = useCallback(() => {
    if (saving) return;
    onClose();
  }, [onClose, saving]);

  useEffect(() => {
    if (!target) return;
    function onPointerDown(e: PointerEvent) {
      if (popoverRef.current?.contains(e.target as Node)) return;
      close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [target, close]);

  if (!target) return null;
  const { highlight, rect } = target;

  async function setColor(color: string) {
    setSaving(true);
    setError(false);
    try {
      const { highlight: updated } = await updateHighlightRequest(
        bookId,
        highlight.id,
        { color },
      );
      onUpdated(updated);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    setSaving(true);
    setError(false);
    try {
      const { highlight: updated } = await updateHighlightRequest(
        bookId,
        highlight.id,
        { note: note.trim() || null },
      );
      onUpdated(updated);
      onClose();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(false);
    try {
      await deleteHighlightRequest(bookId, highlight.id);
      onDeleted(highlight.id);
    } catch {
      setError(true);
      setSaving(false);
    }
  }

  const estHeight = 260;
  const top =
    rect.bottom + estHeight + POPOVER_MARGIN <= window.innerHeight
      ? rect.bottom + POPOVER_MARGIN
      : Math.max(POPOVER_MARGIN, rect.top - estHeight - POPOVER_MARGIN);
  const left = Math.max(
    POPOVER_MARGIN,
    Math.min(
      rect.left + rect.width / 2 - POPOVER_WIDTH / 2,
      window.innerWidth - POPOVER_WIDTH - POPOVER_MARGIN,
    ),
  );

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Edit highlight"
      className="fixed z-50 max-w-[calc(100vw-1rem)] rounded-lg border p-3 shadow-xl"
      style={{
        top,
        left,
        width: POPOVER_WIDTH,
        background: "var(--card)",
        borderColor: "var(--border)",
        color: "var(--card-foreground)",
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="line-clamp-2 min-w-0 flex-1 font-reading text-sm italic opacity-80">
          &ldquo;{highlight.text}&rdquo;
        </p>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          ×
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-label={`${c.label} highlight`}
            aria-pressed={highlight.color === c.id}
            disabled={saving}
            onClick={() => void setColor(c.id)}
            className="flex h-9 w-9 items-center justify-center rounded-full border focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
            style={{
              borderColor:
                highlight.color === c.id
                  ? "var(--world-accent)"
                  : "var(--border)",
            }}
          >
            <span
              aria-hidden="true"
              className="h-4 w-4 rounded-full"
              style={{ background: `var(--highlight-${c.id})` }}
            />
          </button>
        ))}
      </div>

      <label htmlFor="highlight-note" className="eyebrow mb-1 block">
        Note
      </label>
      <textarea
        id="highlight-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Your thoughts on this passage…"
        rows={3}
        className="mb-2 w-full resize-none rounded-md border bg-transparent px-2 py-1.5 font-reading text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        style={{ borderColor: "var(--border)" }}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveNote()}
          className="flex min-h-11 items-center rounded-md border px-3 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
          style={{ borderColor: "var(--border)" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void remove()}
          className="flex min-h-11 items-center rounded-md border px-3 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
          style={{ borderColor: "var(--border)", color: "var(--destructive)" }}
        >
          Remove
        </button>
        {error ? (
          <p className="font-ui text-xs opacity-60">Something went wrong.</p>
        ) : null}
      </div>
    </div>
  );
}
