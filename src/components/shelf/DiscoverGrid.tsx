"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TypographicCover } from "./TypographicCover";
import { BookPreview } from "./BookPreview";
import type { Book } from "./types";

type LoadState = "loading" | "ready" | "error";

// Discover's catalog is intentionally unbounded (self-draining Gutenberg
// ingestion keeps adding to it — see CLAUDE.md), so this always pages a
// fixed-size window server-side rather than loading everything at once.
const PAGE_SIZE = 24;

/**
 * The Discover tab: published books, browsable by any signed-in reader,
 * with a server-side title/author search (`?q=` ILIKE — see
 * src/services/books.ts listPublished) and "Load more" pagination
 * (`?limit=`/`?offset=`). Adding a book to your shelf is free — the
 * analysis (world, entities, overlays) is shared, nothing new gets computed.
 */
export function DiscoverGrid() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Guards against a slow, now-stale request (e.g. an earlier keystroke's
  // search) clobbering the results of a newer one.
  const requestId = useRef(0);

  // Debounce the search box: the catalog search is server-side (a DB ILIKE),
  // unlike the shelf's client-side filter, so every keystroke re-querying
  // would hammer the DB for no benefit.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const id = ++requestId.current;
    (async () => {
      setLoadState("loading");
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (debouncedQuery) params.set("q", debouncedQuery);
        const res = await fetch(`/api/marketplace?${params}`);
        if (!res.ok) throw new Error("Failed to load discover feed");
        const data = (await res.json()) as {
          books: Book[];
          hasMore?: boolean;
        };
        if (cancelled || requestId.current !== id) return;
        setBooks(data.books);
        setHasMore(Boolean(data.hasMore));
        setLoadState("ready");
      } catch {
        if (!cancelled && requestId.current === id) setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(books.length),
      });
      if (debouncedQuery) params.set("q", debouncedQuery);
      const res = await fetch(`/api/marketplace?${params}`);
      if (!res.ok) throw new Error("Failed to load more");
      const data = (await res.json()) as {
        books: Book[];
        hasMore?: boolean;
      };
      setBooks((prev) => [...prev, ...data.books]);
      setHasMore(Boolean(data.hasMore));
    } catch {
      // Best-effort — the "Load more" button just stays put so the reader
      // can retry; no need to roll anything back.
    } finally {
      setLoadingMore(false);
    }
  }

  function handleAdded(bookId: string) {
    setBooks((prev) =>
      prev.map((b) => (b.id === bookId ? { ...b, source: "library" } : b)),
    );
  }

  return (
    <div>
      <SearchBox value={query} onChange={setQuery} />

      {loadState === "loading" ? (
        <DiscoverSkeleton />
      ) : loadState === "error" ? (
        <p className="py-24 text-center font-ui text-sm text-[var(--destructive)]">
          Discover couldn&apos;t be reached. Try refreshing.
        </p>
      ) : books.length === 0 ? (
        <EmptyState query={debouncedQuery} />
      ) : (
        <>
          {/* Announces result count to screen-reader users on every search,
              without moving visual focus. */}
          <p role="status" aria-live="polite" className="sr-only">
            {books.length} book{books.length === 1 ? "" : "s"} found
            {debouncedQuery ? ` for "${debouncedQuery}"` : ""}.
          </p>
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
            {books.map((book) => (
              <DiscoverCard key={book.id} book={book} onAdded={handleAdded} />
            ))}
          </div>
          {hasMore ? (
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                onClick={() => void handleLoadMore()}
                disabled={loadingMore}
                className="rounded-full border border-border px-6 py-2.5 font-ui text-sm font-medium text-foreground transition-colors duration-200 hover:border-[var(--primary)] hover:text-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mb-8">
      <label htmlFor="discover-search" className="sr-only">
        Search Discover by title or author
      </label>
      <input
        id="discover-search"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by title or author…"
        className="w-full max-w-sm rounded-full border border-input bg-background px-4 py-2 font-ui text-sm text-foreground outline-none focus:border-[var(--ring)]"
      />
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  if (query) {
    return (
      <p className="py-24 text-center font-ui text-sm text-muted-foreground">
        No books match &quot;{query}&quot;.
      </p>
    );
  }
  return (
    <p className="py-24 text-center font-ui text-sm text-muted-foreground">
      Nothing published yet — check back soon.
    </p>
  );
}

function DiscoverSkeleton() {
  return (
    <div>
      <p role="status" className="sr-only">
        Browsing the stacks…
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

function DiscoverCard({
  book,
  onAdded,
}: {
  book: Book;
  onAdded: (bookId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const onShelf = book.source === "library" || book.source === "owned";

  async function handleAdd() {
    setAdding(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/marketplace/${book.id}/add`, {
        method: "POST",
      });
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
      {/* Opens a spoiler-free preview (blurb + cover + basic metadata) before
          committing to "Add to shelf" — reuses data already in this card's
          `book` prop, no extra fetch and no world/entities call. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setPreviewOpen(true)}
        aria-haspopup="dialog"
        className="block w-full rounded-lg text-left focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        <TypographicCover
          bookId={book.id}
          title={book.title}
          author={book.author}
          archetype={book.themeArchetype}
          coverUrl={book.coverUrl}
        />

        <div className="mt-3 space-y-0.5">
          <p className="line-clamp-2 font-display text-sm leading-snug text-foreground">
            {book.title}
          </p>
          {book.author ? (
            <p className="font-ui text-xs text-muted-foreground">
              {book.author}
            </p>
          ) : null}
        </div>

        {book.blurb ? (
          <p className="mt-1.5 line-clamp-3 font-reading text-xs leading-relaxed text-muted-foreground">
            {book.blurb}
          </p>
        ) : null}
      </button>

      <p className="mt-1 font-ui text-[11px] text-muted-foreground italic">
        World included
      </p>

      {onShelf ? (
        <Link
          href={`/books/${book.id}`}
          className="mt-2 inline-block font-ui text-xs text-muted-foreground underline underline-offset-2"
        >
          On your shelf — Open
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={adding}
          className="mt-2 rounded-full bg-[var(--primary)] px-3 py-1 font-ui text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add to shelf"}
        </button>
      )}

      {failed ? (
        <p className="mt-1 font-ui text-[11px] text-[var(--destructive)]">
          Couldn&apos;t add — try again.
        </p>
      ) : null}

      {previewOpen ? (
        <BookPreview
          book={book}
          onClose={() => {
            setPreviewOpen(false);
            triggerRef.current?.focus();
          }}
          onAdd={() => void handleAdd()}
          adding={adding}
          failed={failed}
          onShelf={onShelf}
        />
      ) : null}
    </div>
  );
}
