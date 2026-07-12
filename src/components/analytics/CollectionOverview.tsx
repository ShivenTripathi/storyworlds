"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ARCHETYPE_META,
  DEFAULT_ARCHETYPE,
  type Archetype,
} from "@/theme/archetypes";

/**
 * Mirrors CollectionOverviewItem (src/services/analytics.ts) — kept as a
 * local type rather than importing server code into a client bundle.
 */
interface CollectionItem {
  bookId: string;
  title: string;
  themeArchetype: string | null;
  castMet: number;
  castTotal: number;
  progressPercent: number;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; collection: CollectionItem[] };

function isArchetype(value: string | null): value is Archetype {
  return value != null && value in ARCHETYPE_META;
}

/**
 * The Discoveries page's cross-book section: every book the reader has
 * opened, with its discovery progress (cast met/total, overall percent) at
 * a glance. Fetches GET /api/me/collection.
 */
export function CollectionOverview() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/collection", { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        return res.json() as Promise<{ collection: CollectionItem[] }>;
      })
      .then(({ collection }) => {
        if (!cancelled) setState({ status: "ready", collection });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <p className="eyebrow mb-4">Your Collection</p>

      {state.status === "loading" ? (
        <>
          <p role="status" className="sr-only">
            Gathering your collection…
          </p>
          <CollectionSkeleton />
        </>
      ) : null}

      {state.status === "error" ? (
        <p className="font-ui text-sm text-muted-foreground italic">
          Couldn&rsquo;t load your collection — try again shortly.
        </p>
      ) : null}

      {state.status === "ready" && state.collection.length === 0 ? (
        <p className="font-ui text-sm text-muted-foreground italic">
          Open a book from your shelf to start filling this out.
        </p>
      ) : null}

      {state.status === "ready" && state.collection.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {state.collection.map((item) => (
            <CollectionCard key={item.bookId} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CollectionCard({ item }: { item: CollectionItem }) {
  const archetype = isArchetype(item.themeArchetype)
    ? item.themeArchetype
    : DEFAULT_ARCHETYPE;
  const archetypeLabel = ARCHETYPE_META[archetype]?.label ?? "Classic";
  const percent = Math.min(100, Math.max(0, item.progressPercent));

  return (
    <Link
      href={`/books/${item.bookId}`}
      data-world-theme={archetype}
      className="group block rounded-lg border border-border bg-card p-4 transition-colors hover:border-[var(--world-accent)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1" style={{ color: "var(--world-accent)" }}>
            {archetypeLabel}
          </p>
          <p className="line-clamp-2 font-display text-base leading-snug text-foreground">
            {item.title}
          </p>
        </div>
        <span className="shrink-0 font-display text-xl text-foreground tabular-nums">
          {percent}%
        </span>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${percent}%`, background: "var(--world-accent)" }}
        />
      </div>

      <p className="mt-2 font-ui text-xs text-muted-foreground">
        Cast met — {item.castMet} of {item.castTotal}
      </p>
    </Link>
  );
}

function CollectionSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-lg border border-border bg-card motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
