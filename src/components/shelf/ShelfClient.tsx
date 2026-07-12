"use client";

import { useEffect, useRef, useState } from "react";
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
  const [books, setBooks] = useState<Book[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // My Shelf's search is a client-side filter (small, already-fetched list —
  // unlike Discover's server-side ILIKE over an unbounded catalog).
  const [query, setQuery] = useState("");
  // Tracks whether the reader has deliberately picked a tab — once they
  // have, we stop auto-steering them to Discover even if the shelf is
  // (still) empty.
  const userPickedTab = useRef(false);

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
        // A brand-new signed-in reader has an empty shelf — send them
        // straight to the catalog instead of an empty state.
        if (!userPickedTab.current && fetched.length === 0) {
          setTab("discover");
        }
      } catch {
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function selectTab(next: Tab) {
    userPickedTab.current = true;
    setTab(next);
  }

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

  return (
    <div>
      <div className="mb-10">
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">
          Your shelf
        </h1>
        <div className="mt-4 flex items-center gap-6">
          <TabButton
            active={tab === "shelf"}
            onClick={() => selectTab("shelf")}
          >
            MY SHELF
          </TabButton>
          <TabButton
            active={tab === "discover"}
            onClick={() => selectTab("discover")}
          >
            DISCOVER
          </TabButton>
        </div>
      </div>

      {tab === "shelf" ? (
        <>
          {books.length > 0 ? (
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
              <div>
                <label htmlFor="shelf-search" className="sr-only">
                  Search your shelf by title or author
                </label>
                <input
                  id="shelf-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your shelf…"
                  className="w-full max-w-xs rounded-full border border-input bg-background px-4 py-2 font-ui text-sm text-foreground outline-none focus:border-[var(--ring)]"
                />
              </div>
              <Link
                href="/discoveries"
                data-sound="tick"
                className="font-ui text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                See your Discoveries →
              </Link>
            </div>
          ) : null}
          <MyShelf
            books={books}
            query={query}
            loadState={loadState}
            onUploaded={handleUploaded}
            onDelete={handleDelete}
          />
        </>
      ) : (
        <DiscoverGrid />
      )}
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
      aria-pressed={active}
      data-sound="tick"
      className="eyebrow rounded-md border-b-2 pb-1 transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      style={{
        borderColor: active
          ? "var(--world-accent, var(--primary))"
          : "transparent",
        color: active ? "var(--foreground)" : "var(--muted-foreground)",
      }}
    >
      {children}
    </button>
  );
}

function ShelfSkeleton() {
  return (
    <div>
      <p role="status" className="sr-only">
        Gathering your books…
      </p>
      <div
        aria-hidden="true"
        className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div
              className="aspect-[3/4] w-full animate-pulse rounded-lg motion-reduce:animate-none"
              style={{ background: "var(--muted)" }}
            />
            <div
              className="h-3 w-4/5 animate-pulse rounded motion-reduce:animate-none"
              style={{ background: "var(--muted)" }}
            />
            <div
              className="h-2.5 w-2/5 animate-pulse rounded motion-reduce:animate-none"
              style={{ background: "var(--muted)" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Case-insensitive substring match against title OR author. */
function matchesQuery(book: Book, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    book.title.toLowerCase().includes(q) ||
    (book.author?.toLowerCase().includes(q) ?? false)
  );
}

function MyShelf({
  books,
  query,
  loadState,
  onUploaded,
  onDelete,
}: {
  books: Book[];
  query: string;
  loadState: LoadState;
  onUploaded: (book: Book) => void;
  onDelete: (bookId: string) => void;
}) {
  if (loadState === "loading") {
    return <ShelfSkeleton />;
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
        <h2 className="max-w-xl font-display text-3xl leading-tight sm:text-4xl">
          The shelf awaits its first book.
        </h2>
        <p className="mt-6 max-w-md font-ui text-base opacity-70">
          Upload a book to begin — the world inside it will follow. Or visit
          Discover for books others have shared.
        </p>
        <div className="mt-10">
          <UploadBook variant="hero" onUploaded={onUploaded} />
        </div>
      </div>
    );
  }

  const filtered = books.filter((b) => matchesQuery(b, query));

  if (filtered.length === 0) {
    return (
      <div className="py-24 text-center">
        <p role="status" className="font-ui text-sm text-muted-foreground">
          No books match &quot;{query.trim()}&quot;.
        </p>
      </div>
    );
  }

  const inProgress = filtered.filter(
    (b) => (b.progress?.currentChunk ?? 0) > 0,
  );
  const continueBook = inProgress.reduce<Book | null>((best, b) => {
    if (!best) return b;
    const bT = b.progress?.lastReadAt ?? "";
    const bestT = best.progress?.lastReadAt ?? "";
    if (bT !== bestT) return bT > bestT ? b : best;
    return (b.progress?.percent ?? 0) > (best.progress?.percent ?? 0)
      ? b
      : best;
  }, null);

  const gridBooks = continueBook
    ? filtered.filter((b) => b.id !== continueBook.id)
    : filtered;

  return (
    <div>
      {continueBook ? <ContinueReadingHero book={continueBook} /> : null}

      <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
        {gridBooks.map((book) => (
          <BookCard key={book.id} book={book} onDelete={onDelete} />
        ))}
        <UploadBook onUploaded={onUploaded} />
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
        <TypographicCover
          bookId={book.id}
          title={book.title}
          author={book.author}
          archetype={book.themeArchetype}
          coverUrl={book.coverUrl}
        />
      </div>

      <div className="flex flex-1 flex-col justify-center">
        <p className="eyebrow mb-2">CONTINUE READING</p>
        <h2 className="font-display text-2xl leading-tight sm:text-3xl">
          {book.title}
        </h2>
        {book.author ? (
          <p className="mt-1 font-ui text-sm text-muted-foreground">
            {book.author}
          </p>
        ) : null}

        {progress ? (
          <div className="mt-4 max-w-xs">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[var(--world-accent,var(--primary))]"
                style={{
                  width: `${Math.min(100, Math.max(0, progress.percent))}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        <Link
          href={`/books/${book.id}/read`}
          className="mt-5 inline-block w-fit rounded-full bg-[var(--primary)] px-6 py-2.5 font-ui text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          Continue — page {currentPage} of {totalPages}
        </Link>
      </div>
    </div>
  );
}
