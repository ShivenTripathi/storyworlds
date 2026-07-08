"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TypographicCover } from "./TypographicCover";
import { BookCard } from "./BookCard";
import { UploadBook } from "./UploadBook";
import { DiscoverGrid } from "./DiscoverGrid";
import type { Book } from "./types";

type LoadState = "loading" | "ready" | "error";
type Tab = "shelf" | "discover";

export function ShelfClient() {
  const [tab, setTab] = useState<Tab>("shelf");

  return (
    <div>
      <div className="mb-10">
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">Your shelf</h1>
        <div className="mt-4 flex items-center gap-6">
          <TabButton active={tab === "shelf"} onClick={() => setTab("shelf")}>
            MY SHELF
          </TabButton>
          <TabButton active={tab === "discover"} onClick={() => setTab("discover")}>
            DISCOVER
          </TabButton>
        </div>
      </div>

      {tab === "shelf" ? <MyShelf /> : <DiscoverGrid />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="eyebrow border-b-2 pb-1 transition-colors"
      style={{
        borderColor: active ? "var(--world-accent, var(--primary))" : "transparent",
        color: active ? "var(--foreground)" : "var(--muted-foreground)",
      }}
    >
      {children}
    </button>
  );
}

function MyShelf() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/books");
        if (!res.ok) throw new Error("Failed to load shelf");
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

  function handleUploaded(book: Book) {
    setBooks((prev) => [book, ...prev]);
  }

  function handleDelete(bookId: string) {
    const prev = books;
    setBooks((current) => current.filter((b) => b.id !== bookId));
    fetch(`/api/books/${bookId}`, { method: "DELETE" }).catch(() => {
      // best-effort rollback if the delete failed server-side
      setBooks(prev);
    });
  }

  if (loadState === "loading") {
    return (
      <div className="py-24 text-center">
        <p className="font-ui text-sm text-muted-foreground">Gathering your books…</p>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="py-24 text-center">
        <p className="font-ui text-sm text-[var(--destructive)]">
          The shelf couldn&apos;t be reached. Try refreshing.
        </p>
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
        <h2 className="font-display max-w-xl text-3xl leading-tight sm:text-4xl">
          The shelf awaits its first book.
        </h2>
        <p className="font-ui mt-6 max-w-md text-base opacity-70">
          Upload a book to begin — the world inside it will follow. Or visit Discover
          for books others have shared.
        </p>
        <div className="mt-10">
          <UploadBook variant="hero" onUploaded={handleUploaded} />
        </div>
      </div>
    );
  }

  const inProgress = books.filter((b) => (b.progress?.currentChunk ?? 0) > 0);
  const continueBook = inProgress.reduce<Book | null>((best, b) => {
    if (!best) return b;
    const bT = b.progress?.lastReadAt ?? "";
    const bestT = best.progress?.lastReadAt ?? "";
    if (bT !== bestT) return bT > bestT ? b : best;
    return (b.progress?.percent ?? 0) > (best.progress?.percent ?? 0) ? b : best;
  }, null);

  const gridBooks = continueBook
    ? books.filter((b) => b.id !== continueBook.id)
    : books;

  return (
    <div>
      {continueBook ? <ContinueReadingHero book={continueBook} /> : null}

      <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
        {gridBooks.map((book) => (
          <BookCard key={book.id} book={book} onDelete={handleDelete} />
        ))}
        <UploadBook onUploaded={handleUploaded} />
      </div>
    </div>
  );
}

function ContinueReadingHero({ book }: { book: Book }) {
  const progress = book.progress;
  const currentPage = progress?.currentChunk ?? 0;
  const totalPages = book.totalChunks;

  return (
    <div className="mb-10 flex flex-col gap-6 rounded-lg border border-border bg-card p-6 sm:flex-row">
      <div className="w-full sm:w-40">
        <TypographicCover bookId={book.id} title={book.title} author={book.author} />
      </div>

      <div className="flex flex-1 flex-col justify-center">
        <p className="eyebrow mb-2">CONTINUE READING</p>
        <h2 className="font-display text-2xl leading-tight sm:text-3xl">{book.title}</h2>
        {book.author ? (
          <p className="font-ui mt-1 text-sm text-muted-foreground">{book.author}</p>
        ) : null}

        {progress ? (
          <div className="mt-4 max-w-xs">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[var(--world-accent,var(--primary))]"
                style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
              />
            </div>
          </div>
        ) : null}

        <Link
          href={`/books/${book.id}/read`}
          className="font-ui mt-5 inline-block w-fit rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
        >
          Continue — page {currentPage} of {totalPages}
        </Link>
      </div>
    </div>
  );
}
