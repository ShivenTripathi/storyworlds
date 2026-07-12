"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CATALOG_SEED } from "@/catalog/gutenberg";
import type { Archetype } from "@/theme/archetypes";
import { AdminBooksTable } from "./AdminBooksTable";
import type { AdminOverview } from "./types";

const POLL_MS = 30_000;

type LoadState = "loading" | "ready" | "error";

export function AdminClient() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const overviewRef = useRef<AdminOverview | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/overview");
      if (!res.ok) throw new Error("Failed to load overview");
      const data = (await res.json()) as AdminOverview;
      overviewRef.current = data;
      setOverview(data);
      setLoadState("ready");
    } catch {
      setLoadState((prev) => (prev === "ready" ? prev : "error"));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, POLL_MS);

    function onVisible() {
      if (document.visibilityState === "visible") {
        void load();
      }
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  async function withOptimisticReload(action: () => Promise<Response>) {
    const res = await action();
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? "That action failed. Try again.");
    }
    await load();
  }

  async function handleTogglePublish(
    bookId: string,
    next: "published" | "private",
  ) {
    await withOptimisticReload(() =>
      fetch(
        `/api/admin/books/${bookId}/${next === "published" ? "publish" : "unpublish"}`,
        {
          method: "POST",
        },
      ),
    );
  }

  async function handleArchetypeChange(bookId: string, archetype: Archetype) {
    await withOptimisticReload(() =>
      fetch(`/api/admin/books/${bookId}/archetype`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archetype }),
      }),
    );
  }

  async function handleRetry(bookId: string) {
    await withOptimisticReload(() =>
      fetch(`/api/admin/books/${bookId}/retry-analysis`, { method: "POST" }),
    );
  }

  if (loadState === "loading") {
    return (
      <div className="py-24 text-center">
        <p className="eyebrow mb-6">THE PRESS ROOM</p>
        <p className="font-ui text-sm text-muted-foreground">
          Gathering the ledgers…
        </p>
      </div>
    );
  }

  if (loadState === "error" || !overview) {
    return (
      <div className="py-24 text-center">
        <p className="eyebrow mb-6">THE PRESS ROOM</p>
        <p className="font-ui text-sm text-[var(--destructive)]">
          The overview couldn&apos;t be reached. Try refreshing.
        </p>
      </div>
    );
  }

  const { totals, books } = overview;

  return (
    <div>
      <div className="mb-8">
        <p className="eyebrow mb-2">THE PRESS ROOM</p>
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">
          Admin
        </h1>
      </div>

      <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatBlock label="Books" value={totals.books.toLocaleString()} />
        <StatBlock label="Users" value={totals.users.toLocaleString()} />
        <StatBlock label="Spend" value={`$${totals.spendUsd.toFixed(2)}`} />
        <StatBlock
          label="Tokens today"
          value={totals.tokensToday.toLocaleString()}
        />
      </div>

      <CatalogQueue books={books} />

      <AdminBooksTable
        books={books}
        onTogglePublish={handleTogglePublish}
        onArchetypeChange={handleArchetypeChange}
        onRetry={handleRetry}
      />
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="eyebrow mb-1">{label}</p>
      <p className="font-display text-2xl">{value}</p>
    </div>
  );
}

/**
 * Shows CATALOG_SEED ingestion progress (which of the curated Gutenberg
 * titles are ready/pending) and lets an admin kick the ingestion queue
 * immediately instead of waiting for the cron tick.
 */
function CatalogQueue({ books }: { books: AdminOverview["books"] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const ingestedSources = new Set(
    books.map((b) => b.catalogSource).filter((s): s is string => Boolean(s)),
  );

  const ready = CATALOG_SEED.filter((s) =>
    ingestedSources.has(`gutenberg:${s.gutenbergId}`),
  );
  const pending = CATALOG_SEED.filter(
    (s) => !ingestedSources.has(`gutenberg:${s.gutenbergId}`),
  );

  async function handleIngestNext() {
    setBusy(true);
    setFailed(false);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/catalog/ingest", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          body?.error?.message ?? "Couldn't queue the next title.",
        );
      }
      setMessage(
        pending.length > 0
          ? `Queued "${pending[0].title}" for ingestion.`
          : "Queued — refresh in a moment to see it land.",
      );
    } catch (e) {
      setFailed(true);
      setMessage(
        e instanceof Error ? e.message : "Couldn't queue the next title.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-8 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Catalog queue</p>
          <p className="font-ui text-sm text-muted-foreground">
            {ready.length} of {CATALOG_SEED.length} Gutenberg seed titles
            ingested
          </p>
        </div>
        <button
          type="button"
          onClick={handleIngestNext}
          disabled={busy || pending.length === 0}
          className="rounded-full bg-[var(--primary)] px-4 py-1.5 font-ui text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? "Queuing…"
            : pending.length === 0
              ? "All ingested"
              : "Ingest next now"}
        </button>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[var(--world-accent)] transition-[width] duration-500"
          style={{ width: `${(ready.length / CATALOG_SEED.length) * 100}%` }}
        />
      </div>

      {pending.length > 0 ? (
        <p className="mt-2 font-ui text-xs text-muted-foreground">
          Next up: {pending[0].title} ({pending.length - 1} more waiting)
        </p>
      ) : null}

      {message ? (
        <p
          className="mt-2 font-ui text-xs"
          style={{
            color: failed ? "var(--destructive)" : "var(--muted-foreground)",
          }}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
