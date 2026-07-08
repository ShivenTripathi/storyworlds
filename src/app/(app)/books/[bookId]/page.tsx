"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TypographicCover } from "@/components/shelf/TypographicCover";
import type { Book, ApiErrorBody } from "@/components/shelf/types";

type LoadState = "loading" | "ready" | "not-found" | "error";

export default function BookDetailPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = use(params);
  const router = useRouter();

  const [book, setBook] = useState<Book | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [removing, setRemoving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/books/${bookId}`);
        if (res.status === 404) {
          if (!cancelled) setLoadState("not-found");
          return;
        }
        if (!res.ok) throw new Error("Failed to load book");
        const data = (await res.json()) as { book: Book; progress?: Book["progress"] };
        if (cancelled) return;
        setBook({ ...data.book, progress: data.progress ?? data.book.progress });
        setLoadState("ready");
      } catch {
        if (!cancelled) setLoadState("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  async function handleRemove() {
    setRemoving(true);
    try {
      const res = await fetch(`/api/books/${bookId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(body?.error?.message ?? "Couldn't remove this book.");
      }
      router.push("/shelf");
    } catch {
      setRemoving(false);
      setConfirmingRemove(false);
    }
  }

  if (loadState === "loading") {
    return (
      <div className="py-24 text-center">
        <p className="font-ui text-sm text-muted-foreground">Opening the book…</p>
      </div>
    );
  }

  if (loadState === "not-found") {
    return (
      <div className="py-24 text-center">
        <p className="eyebrow mb-4">NOT FOUND</p>
        <h1 className="font-display text-3xl">This book isn&apos;t on your shelf.</h1>
        <Link
          href="/shelf"
          className="font-ui mt-6 inline-block text-sm text-[var(--primary)] hover:opacity-80"
        >
          Back to your shelf
        </Link>
      </div>
    );
  }

  if (loadState === "error" || !book) {
    return (
      <div className="py-24 text-center">
        <p className="font-ui text-sm text-[var(--destructive)]">
          Couldn&apos;t reach the shelf. Try refreshing.
        </p>
      </div>
    );
  }

  const progress = book.progress;
  const started = (progress?.currentChunk ?? 0) > 0;
  const readHref = `/books/${book.id}/read`;

  return (
    <div>
      <div className="grid grid-cols-1 gap-10 sm:grid-cols-[minmax(0,240px)_1fr]">
        <TypographicCover bookId={book.id} title={book.title} author={book.author} size="lg" />

        <div className="flex flex-col justify-center">
          <p className="eyebrow mb-2">IN YOUR LIBRARY</p>
          <h1 className="font-display text-3xl leading-tight sm:text-4xl">{book.title}</h1>
          {book.author ? (
            <p className="font-ui mt-2 text-sm text-muted-foreground">{book.author}</p>
          ) : null}

          <p className="font-ui mt-4 text-sm text-muted-foreground">
            {book.totalWords.toLocaleString()} words · {book.totalChunks.toLocaleString()} pages
          </p>

          <p className="font-ui mt-1 text-sm text-muted-foreground">
            {started
              ? `You're on page ${progress?.currentChunk} of ${book.totalChunks} — ${Math.round(
                  progress?.percent ?? 0,
                )}%`
              : "Not started"}
          </p>

          <div className="mt-6 flex items-center gap-4">
            <Link
              href={readHref}
              className="font-ui rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
            >
              {started ? "Continue reading" : "Begin reading"}
            </Link>

            {!confirmingRemove ? (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className="font-ui text-sm text-muted-foreground hover:text-[var(--destructive)]"
              >
                Remove from shelf
              </button>
            ) : (
              <div className="font-ui flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Remove this book?</span>
                <button
                  type="button"
                  disabled={removing}
                  onClick={handleRemove}
                  className="font-medium text-[var(--destructive)] hover:opacity-80"
                >
                  {removing ? "Removing…" : "Confirm"}
                </button>
                <button
                  type="button"
                  disabled={removing}
                  onClick={() => setConfirmingRemove(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-12 rounded-lg border border-border bg-card p-6">
        <p className="eyebrow mb-2">STORY WORLD</p>
        <p className="font-ui text-sm text-muted-foreground">
          The world of this book will awaken here once analysis arrives.
        </p>
      </div>
    </div>
  );
}
