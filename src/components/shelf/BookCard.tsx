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
  const isExtracting = book.status === "extracting" || book.status === "uploaded";

  async function handleConfirmDelete() {
    setDeleting(true);
    onDelete(book.id);
  }

  return (
    <div className="group relative">
      <Link
        href={`/books/${book.id}`}
        aria-label={`Open ${book.title}`}
        className={`block rounded-lg outline-none transition-all duration-200 ease-out focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
          deleting ? "pointer-events-none opacity-40" : "hover:-translate-y-0.5 hover:shadow-lg"
        }`}
      >
        <div className="relative">
          <TypographicCover bookId={book.id} title={book.title} author={book.author} />

          {isFailed ? (
            <div className="absolute inset-0 flex items-end rounded-lg bg-[var(--oxblood-500)]/20">
              <p className="font-ui w-full bg-[var(--oxblood-500)]/80 px-3 py-1.5 text-center text-xs font-medium text-[var(--parchment-100)]">
                extraction failed
              </p>
            </div>
          ) : null}

          {isExtracting ? (
            <div className="absolute inset-0 flex items-end rounded-lg">
              <p className="font-ui w-full animate-pulse bg-[var(--ink-950)]/70 px-3 py-1.5 text-center text-xs font-medium text-[var(--parchment-100)]">
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

        <div className="mt-3 space-y-0.5">
          <p className="font-display line-clamp-2 text-sm leading-snug text-foreground">
            {book.title}
          </p>
          {book.author ? (
            <p className="font-ui text-xs text-muted-foreground">{book.author}</p>
          ) : null}
        </div>
      </Link>

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
            className="font-ui flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ink-950)]/60 text-[var(--parchment-100)] opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:bg-[var(--ink-950)]/80 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            ⋯
          </button>
        ) : menu === "open" ? (
          <div className="font-ui overflow-hidden rounded-md border border-border bg-card text-xs shadow-lg">
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
          <div className="font-ui flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-lg">
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
