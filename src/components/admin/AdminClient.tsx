"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
    if (!res.ok) throw new Error("Action failed");
    await load();
  }

  async function handleTogglePublish(bookId: string, next: "published" | "private") {
    await withOptimisticReload(() =>
      fetch(`/api/admin/books/${bookId}/${next === "published" ? "publish" : "unpublish"}`, {
        method: "POST",
      }),
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
        <p className="font-ui text-sm text-muted-foreground">Gathering the ledgers…</p>
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
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">Admin</h1>
      </div>

      <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatBlock label="Books" value={totals.books.toLocaleString()} />
        <StatBlock label="Users" value={totals.users.toLocaleString()} />
        <StatBlock label="Spend" value={`$${totals.spendUsd.toFixed(4)}`} />
        <StatBlock label="Tokens today" value={totals.tokensToday.toLocaleString()} />
      </div>

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
