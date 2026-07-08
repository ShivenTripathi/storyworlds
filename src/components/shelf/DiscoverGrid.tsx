"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TypographicCover } from "./TypographicCover";
import type { Book } from "./types";

type LoadState = "loading" | "ready" | "error";

/**
 * The Discover tab: every published book, browsable by any signed-in
 * reader. Adding one to your shelf is free — the analysis (world,
 * entities, overlays) is shared, nothing new gets computed.
 */
export function DiscoverGrid() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/marketplace");
        if (!res.ok) throw new Error("Failed to load discover feed");
        const { books: fetched } = (await res.json()) as { books: Book[] };
        if (cancelled) return;
        setBooks(fetched);
        setLoadState("ready");
      } catch {
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleAdded(bookId: string) {
    setBooks((prev) =>
      prev.map((b) => (b.id === bookId ? { ...b, source: "library" } : b)),
    );
  }

  if (loadState === "loading") {
    return (
      <p className="font-ui py-24 text-center text-sm text-muted-foreground">
        Browsing the stacks…
      </p>
    );
  }

  if (loadState === "error") {
    return (
      <p className="font-ui py-24 text-center text-sm text-[var(--destructive)]">
        Discover couldn&apos;t be reached. Try refreshing.
      </p>
    );
  }

  if (books.length === 0) {
    return (
      <p className="font-ui py-24 text-center text-sm text-muted-foreground">
        Nothing published yet — check back soon.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
      {books.map((book) => (
        <DiscoverCard key={book.id} book={book} onAdded={handleAdded} />
      ))}
    </div>
  );
}

function DiscoverCard({
  book,
  onAdded,
}: {
  book: Book;
  onAdded: (bookId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState(false);
  const onShelf = book.source === "library" || book.source === "owned";

  async function handleAdd() {
    setAdding(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/marketplace/${book.id}/add`, { method: "POST" });
      if (!res.ok) throw new Error("add failed");
      onAdded(book.id);
    } catch {
      setFailed(true);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <TypographicCover
        bookId={book.id}
        title={book.title}
        author={book.author}
        archetype={book.themeArchetype}
      />

      <div className="mt-3 space-y-0.5">
        <p className="font-display line-clamp-2 text-sm leading-snug text-foreground">
          {book.title}
        </p>
        {book.author ? (
          <p className="font-ui text-xs text-muted-foreground">{book.author}</p>
        ) : null}
      </div>

      <p className="font-ui mt-1 text-[11px] text-muted-foreground italic">World included</p>

      {onShelf ? (
        <Link
          href={`/books/${book.id}`}
          className="font-ui mt-2 inline-block text-xs text-muted-foreground underline underline-offset-2"
        >
          On your shelf — Open
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={adding}
          className="font-ui mt-2 rounded-full bg-[var(--primary)] px-3 py-1 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add to shelf"}
        </button>
      )}

      {failed ? (
        <p className="font-ui mt-1 text-[11px] text-[var(--destructive)]">
          Couldn&apos;t add — try again.
        </p>
      ) : null}
    </div>
  );
}
