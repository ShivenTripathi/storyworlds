"use client";

import { useState } from "react";
import Link from "next/link";
import { TypographicCover } from "./TypographicCover";
import type { Book } from "./types";

interface BookCardProps {
  book: Book;
  onDelete: (bookId: string) => void;
}

type MenuState = "closed" | "open" | "confirming";

export function BookCard({ book, onDelete }: BookCardProps) {
  const [menu, setMenu] = useState<MenuState>("closed");
  const [deleting, setDeleting] = useState(false);

  const percent = book.progress?.percent ?? 0;
  const started = (book.progress?.currentChunk ?? 0) > 0;
  const isFailed = book.status === "failed";
  const isExtracting =
    book.status === "extracting" || book.status === "uploaded";

  async function handleConfirmDelete() {
    setDeleting(true);
    onDelete(book.id);
  }

  /**
   * A failed book has nothing to open — the reader route only handles books
   * that finished extraction. Rather than clicking through to a broken
   * reader, the retry CTA reopens the add-book dialog (its "tile" trigger is
   * always present in the grid alongside this card — see UploadBook.tsx's
   * [data-add-book-trigger]). Wiring a dedicated "open the dialog" callback
   * through ShelfClient would be the more direct route, but this keeps the
   * fix self-contained to the card.
   */
  function handleRetry(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    document
      .querySelector<HTMLButtonElement>("[data-add-book-trigger]")
      ?.click();
  }

  const cover = (
    <div className="relative">
      <TypographicCover
        bookId={book.id}
        title={book.title}
        author={book.author}
        archetype={book.themeArchetype}
        coverUrl={book.coverUrl}
      />

      {isFailed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-end gap-2 rounded-lg bg-[var(--oxblood-500)]/20 p-3">
          <p className="w-full rounded bg-[var(--oxblood-500)]/80 px-3 py-1.5 text-center font-ui text-xs font-medium text-[var(--parchment-100)]">
            Extraction failed
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="w-full rounded-full bg-[var(--parchment-100)] px-3 py-1.5 font-ui text-xs font-medium text-[var(--ink-950)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          >
            Try again
          </button>
        </div>
      ) : null}

      {isExtracting ? (
        <div className="absolute inset-0 flex items-end rounded-lg">
          <p className="w-full animate-pulse bg-[var(--ink-950)]/70 px-3 py-1.5 text-center font-ui text-xs font-medium text-[var(--parchment-100)]">
            preparing…
          </p>
        </div>
      ) : null}

      {started && !isFailed ? (
        <div className="absolute inset-x-0 bottom-0 h-1 rounded-b-lg bg-[var(--ink-950)]/40">
          <div
            className="h-full rounded-b-lg bg-[var(--world-accent)]"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
      ) : null}
    </div>
  );

  const meta = (
    <>
      <div className="mt-3 space-y-0.5">
        <p className="line-clamp-2 font-display text-sm leading-snug text-foreground">
          {book.title}
        </p>
        {book.author ? (
          <p className="font-ui text-xs text-muted-foreground">{book.author}</p>
        ) : null}
      </div>

      {book.blurb ? (
        <p className="mt-1.5 line-clamp-3 font-reading text-xs leading-relaxed text-muted-foreground">
          {book.blurb}
        </p>
      ) : null}
    </>
  );

  return (
    <div className="group relative">
      {isFailed ? (
        // Non-navigable: a failed extraction has no reader to open. The
        // "Try again" button above is the only interactive affordance here.
        <div
          aria-label={`${book.title}, extraction failed`}
          className="block rounded-lg"
        >
          {cover}
          {meta}
        </div>
      ) : (
        <Link
          href={`/books/${book.id}`}
          aria-label={`Open ${book.title}`}
          className={`block rounded-lg transition-all duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
            deleting
              ? "pointer-events-none opacity-40"
              : "hover:-translate-y-0.5 hover:shadow-lg"
          }`}
        >
          {cover}
          {meta}
        </Link>
      )}

      {/* overflow / delete affordance */}
      <div className="absolute top-2 right-2">
        {menu === "closed" ? (
          <button
            type="button"
            aria-label="Book options"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu("open");
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ink-950)]/60 font-ui text-base text-[var(--parchment-100)] opacity-80 transition-opacity duration-200 group-hover:opacity-100 hover:bg-[var(--ink-950)]/80 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          >
            ⋯
          </button>
        ) : menu === "open" ? (
          <div className="overflow-hidden rounded-md border border-border bg-card font-ui text-xs shadow-lg">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu("confirming");
              }}
              className="block w-full px-3 py-1.5 text-left text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
            >
              Remove from shelf
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu("closed");
              }}
              className="block w-full px-3 py-1.5 text-left text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-ui text-xs shadow-lg">
            <span className="mr-1 text-muted-foreground">Remove?</span>
            <button
              type="button"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleConfirmDelete();
              }}
              className="rounded px-1.5 py-0.5 font-medium text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
            >
              {deleting ? "…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu("closed");
              }}
              className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
