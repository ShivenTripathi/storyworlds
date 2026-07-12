"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { TypographicCover } from "./TypographicCover";
import type { Book } from "./types";

interface BookPreviewProps {
  book: Book;
  onClose: () => void;
  onAdd: () => void;
  adding: boolean;
  failed: boolean;
  onShelf: boolean;
}

/**
 * A lightweight "second look" for a Discover book BEFORE adding it — the
 * blocker this fixes is that an un-added book couldn't be seen in any more
 * detail than its grid card (title/author + a 3-line blurb clamp). Opens
 * over the grid without navigating, showing the full spoiler-free blurb,
 * cover, and basic metadata that already flow through `toBookDto`
 * (books.blurb, coverUrl, totalWords/totalChunks, pricingTier).
 *
 * Deliberately does NOT call the world/entities API (src/services/world.ts) —
 * unlike the book detail page, this never fetches anything frontier-gated,
 * so there's no spoiler-safety logic to get right here: it only ever
 * displays fields the reader already received in the Discover feed.
 */
export function BookPreview({
  book,
  onClose,
  onAdd,
  adding,
  failed,
  onShelf,
}: BookPreviewProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = `book-preview-title-${book.id}`;

  useEffect(() => {
    closeButtonRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    // Backdrop: click-to-close is a mouse convenience; the dialog is also
    // dismissible via the Close button and the Escape key above.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="grid w-full max-w-lg grid-cols-[minmax(0,120px)_1fr] gap-5 rounded-lg border border-border bg-card p-6 shadow-2xl sm:max-w-xl sm:grid-cols-[minmax(0,160px)_1fr]"
      >
        <TypographicCover
          bookId={book.id}
          title={book.title}
          author={book.author}
          archetype={book.themeArchetype}
          coverUrl={book.coverUrl}
        />

        <div className="flex min-w-0 flex-col">
          <p className="eyebrow mb-1">PREVIEW</p>
          <h2
            id={titleId}
            className="font-display text-xl leading-tight sm:text-2xl"
          >
            {book.title}
          </h2>
          {book.author ? (
            <p className="mt-1 font-ui text-sm text-muted-foreground">
              {book.author}
            </p>
          ) : null}

          {book.blurb ? (
            <p className="mt-3 font-reading text-sm leading-relaxed text-foreground">
              {book.blurb}
            </p>
          ) : (
            <p className="mt-3 font-ui text-sm text-muted-foreground italic">
              No back-cover blurb yet.
            </p>
          )}

          <p className="mt-3 font-ui text-xs text-muted-foreground">
            {book.totalWords.toLocaleString()} words ·{" "}
            {book.totalChunks.toLocaleString()} pages
          </p>
          <p className="mt-1 font-ui text-[11px] text-muted-foreground italic">
            World included — revealed only as far as you read.
          </p>

          <div className="mt-5 flex items-center gap-4">
            {onShelf ? (
              <Link
                href={`/books/${book.id}`}
                className="rounded-full bg-[var(--primary)] px-5 py-2 font-ui text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                On your shelf — Open
              </Link>
            ) : (
              <button
                type="button"
                onClick={onAdd}
                disabled={adding}
                className="rounded-full bg-[var(--primary)] px-5 py-2 font-ui text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
              >
                {adding ? "Adding…" : "Add to shelf"}
              </button>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="font-ui text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              Close
            </button>
          </div>

          {failed ? (
            <p className="mt-2 font-ui text-xs text-[var(--destructive)]">
              Couldn&apos;t add — try again.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
