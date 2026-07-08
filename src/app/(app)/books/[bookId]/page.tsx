"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TypographicCover } from "@/components/shelf/TypographicCover";
import type { Book, ApiErrorBody } from "@/components/shelf/types";
import { WorldFormingCard } from "@/components/world/WorldFormingCard";
import { CastList } from "@/components/world/CastList";
import { useJob } from "@/components/world/useJob";
import { analyzeBook, fetchWorld } from "@/components/world/api";
import type { World } from "@/components/world/types";

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

  const [world, setWorld] = useState<World | null>(null);
  const [worldLoaded, setWorldLoaded] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useJob(jobId);
  const prevJobStatus = useRef<string | null>(null);

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

  const loadWorld = useCallback(async () => {
    try {
      const { world: w, job: j } = await fetchWorld(bookId);
      setWorld(w);
      if (j && (j.status === "queued" || j.status === "running")) {
        setJobId(j.id);
      }
    } catch {
      // best-effort — the invite card will still let the reader retry
    } finally {
      setWorldLoaded(true);
    }
  }, [bookId]);

  useEffect(() => {
    // Fetch on mount — a deliberate sync-with-server effect, not state
    // derivable from existing props/state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWorld();
  }, [loadWorld]);

  // When the live job transitions to completed, re-fetch the world so the
  // reveal (archetype, cast, setting) happens in place — no reload.
  useEffect(() => {
    if (!job) return;
    if (job.status === "completed" && prevJobStatus.current !== "completed") {
      void loadWorld();
    }
    prevJobStatus.current = job.status;
  }, [job, loadWorld]);

  async function handleAwaken() {
    setWorld((w) => (w ? { ...w, status: "pending" } : { status: "pending" }));
    try {
      const result = await analyzeBook(bookId);
      if (result) {
        setJobId(result.job.id);
      } else {
        // already_analyzed — the world exists server-side; refetch it.
        await loadWorld();
      }
    } catch {
      setWorld((w) => (w ? { ...w, status: "failed" } : { status: "failed" }));
    }
  }

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

  const worldRevealed = world?.status === "completed";
  const archetype = worldRevealed ? world?.themeArchetype : undefined;

  return (
    <div data-world-theme={archetype} style={{ transition: "color 700ms ease" }}>
      <div className="grid grid-cols-1 gap-10 sm:grid-cols-[minmax(0,240px)_1fr]">
        <div data-world-theme={archetype} style={{ transition: "background-color 700ms ease, border-color 700ms ease" }}>
          <TypographicCover
            bookId={book.id}
            title={book.title}
            author={book.author}
            size="lg"
            archetype={archetype}
          />
        </div>

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

      <div className="mt-12">
        <StoryWorldSection
          bookReady={book.status === "ready"}
          worldLoaded={worldLoaded}
          world={world}
          job={job}
          onAwaken={handleAwaken}
        />
      </div>
    </div>
  );
}

function StoryWorldSection({
  bookReady,
  worldLoaded,
  world,
  job,
  onAwaken,
}: {
  bookReady: boolean;
  worldLoaded: boolean;
  world: World | null;
  job: ReturnType<typeof useJob>["job"];
  onAwaken: () => void | Promise<void>;
}) {
  if (!bookReady) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="eyebrow mb-2">STORY WORLD</p>
        <p className="font-ui text-sm text-muted-foreground">
          The world of this book will awaken here once analysis arrives.
        </p>
      </div>
    );
  }

  if (!worldLoaded) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="eyebrow mb-2">STORY WORLD</p>
        <p className="font-ui text-sm text-muted-foreground">Opening the world…</p>
      </div>
    );
  }

  const status = world?.status ?? "none";
  const isPending = status === "pending" || (job && (job.status === "queued" || job.status === "running"));
  const isFailed = status === "failed" || job?.status === "failed";

  if (status === "completed" && world) {
    return (
      <div
        data-world-theme={world.themeArchetype}
        className="rounded-lg border border-[var(--world-frame)] bg-[var(--world-surface)] p-6"
        style={{ transition: "background-color 700ms ease, border-color 700ms ease, color 700ms ease" }}
      >
        <p className="eyebrow mb-2">STORY WORLD</p>

        {world.settingDescription ? (
          <p className="font-reading mt-2 text-[15px] leading-relaxed text-[var(--card-foreground)]">
            {world.settingDescription}
          </p>
        ) : null}

        {world.visualStyle ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(world.visualStyle)
              .filter(([, value]) => Boolean(value))
              .map(([key, value]) => (
                <span
                  key={key}
                  className="font-ui rounded-full border px-3 py-1 text-xs"
                  style={{ borderColor: "var(--world-frame)", color: "var(--world-accent)" }}
                >
                  {value}
                </span>
              ))}
          </div>
        ) : null}

        {world.entities && world.entities.length > 0 ? (
          <div className="mt-6">
            <CastList entities={world.entities} counts={world.counts} />
          </div>
        ) : null}
      </div>
    );
  }

  if (isFailed) {
    return (
      <div>
        <p className="eyebrow mb-2">STORY WORLD</p>
        <WorldFormingCard
          job={job ?? { id: "", status: "failed", progress: 0, error: null }}
          onRetry={onAwaken}
        />
      </div>
    );
  }

  if (isPending) {
    return (
      <div>
        <p className="eyebrow mb-2">STORY WORLD</p>
        <WorldFormingCard
          job={job ?? { id: "", status: "running", progress: 0, stage: null }}
          onRetry={onAwaken}
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <p className="eyebrow mb-2">STORY WORLD</p>
      <h2 className="font-display mt-1 text-2xl leading-snug">Awaken the world of this book.</h2>
      <p className="font-ui mt-2 text-sm text-muted-foreground">
        Meet its cast, its setting, and its shape — revealed only as far as you&apos;ve read.
      </p>
      <button
        type="button"
        onClick={() => void onAwaken()}
        className="font-ui mt-4 rounded-full bg-[var(--primary)] px-6 py-2.5 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
      >
        Awaken the world
      </button>
    </div>
  );
}
