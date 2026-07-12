"use client";

import { useEffect, useMemo, useState } from "react";
import { CodexCardTile } from "./CodexCardTile";
import { ProgressRing } from "./ProgressRing";
import type { CodexDto } from "./types";

type LoadState = "loading" | "ready" | "error";

// Canonical entity kinds (src/db/schema.ts entities.kind) in the display
// order the completion header/tabs read best in — cast first, then the
// rest of the world. Any kind outside this set (shouldn't happen, but the
// contract is just `string`) still gets a tab, appended after these.
const KIND_ORDER = ["character", "location", "object", "faction"] as const;

const KIND_LABELS: Record<string, string> = {
  character: "Cast",
  location: "Places",
  object: "Artifacts",
  faction: "Factions",
};

function labelFor(kind: string): string {
  return KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

interface BookCodexProps {
  bookId: string;
}

/**
 * The per-book gamified Codex: a collectible-card grid of every entity the
 * analysis pipeline found for this book, spoiler-gated by the reader's
 * frontier. Data comes from GET /api/books/{bookId}/codex, which wraps
 * getCodexForBook (src/services/analytics.ts) — locked cards there carry
 * only `kind`+`slot`, nothing that could identify or spoil the entity, and
 * this component never reaches for anything beyond what's on the card.
 */
export function BookCodex({ bookId }: BookCodexProps) {
  const [data, setData] = useState<CodexDto | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [activeTab, setActiveTab] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    // Deliberate reset of UI-only state when `bookId` changes, not a
    // derivation of props/state already in React (mirrors the pattern in
    // components/reader/SceneView.tsx).
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadState("loading");
    setData(null);
    setActiveTab("all");
    /* eslint-enable react-hooks/set-state-in-effect */

    (async () => {
      try {
        const res = await fetch(`/api/books/${bookId}/codex`, {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`codex fetch failed (${res.status})`);
        const json = (await res.json()) as CodexDto;
        if (cancelled) return;
        setData(json);
        setLoadState("ready");
      } catch {
        if (!cancelled) setLoadState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const tabs = useMemo(() => {
    if (!data) return [];
    const keys = Object.keys(data.counts);
    const ordered = KIND_ORDER.filter((k) => keys.includes(k));
    const rest = keys.filter(
      (k) => !(KIND_ORDER as readonly string[]).includes(k),
    );
    return [...ordered, ...rest];
  }, [data]);

  const overall = useMemo(() => {
    if (!data) return { met: 0, total: 0 };
    return Object.values(data.counts).reduce(
      (acc, c) => ({ met: acc.met + c.met, total: acc.total + c.total }),
      { met: 0, total: 0 },
    );
  }, [data]);

  const visibleCards = useMemo(() => {
    if (!data) return [];
    const filtered =
      activeTab === "all"
        ? data.cards
        : data.cards.filter((c) => c.kind === activeTab);
    // `slot` is the stable, content-independent grid position the server
    // assigns (see getCodexForBook) — sort by it so the grid never
    // reshuffles between fetches.
    return [...filtered].sort((a, b) => a.slot - b.slot);
  }, [data, activeTab]);

  if (loadState === "loading") {
    return <CodexSkeleton />;
  }

  if (loadState === "error") {
    return (
      <p className="py-16 text-center font-ui text-sm text-[var(--destructive)]">
        Your discoveries couldn&apos;t be reached. Try refreshing.
      </p>
    );
  }

  if (!data || data.cards.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="eyebrow mb-2">YOUR DISCOVERIES</p>
        <p className="font-display text-lg text-muted-foreground italic">
          This world is still forming…
        </p>
        <p className="mt-1 font-ui text-xs text-muted-foreground">
          Cards will appear here once the book&apos;s cast, places, and
          artifacts have been discovered.
        </p>
      </div>
    );
  }

  const percent =
    overall.total > 0 ? Math.round((overall.met / overall.total) * 100) : 0;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-1">YOUR DISCOVERIES</p>
          <p className="font-ui text-sm text-foreground">
            You&apos;ve discovered {overall.met} of {overall.total}
          </p>
          <p className="mt-0.5 font-ui text-sm text-muted-foreground">
            {tabs
              .map(
                (k) =>
                  `${labelFor(k)} ${data.counts[k].met}/${data.counts[k].total}`,
              )
              .join(" · ")}
          </p>
        </div>
        <ProgressRing percent={percent} label="Discoveries completion" />
      </header>

      <div
        role="tablist"
        aria-label="Codex categories"
        className="mb-5 flex items-center gap-2 overflow-x-auto pb-1"
      >
        <TabButton
          active={activeTab === "all"}
          onClick={() => setActiveTab("all")}
          label={`All ${overall.met}/${overall.total}`}
        />
        {tabs.map((k) => (
          <TabButton
            key={k}
            active={activeTab === k}
            onClick={() => setActiveTab(k)}
            label={`${labelFor(k)} ${data.counts[k].met}/${data.counts[k].total}`}
          />
        ))}
      </div>

      {visibleCards.length === 0 ? (
        <p className="py-10 text-center font-ui text-sm text-muted-foreground italic">
          Nothing in this category yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-4">
          {visibleCards.map((card) => (
            <CodexCardTile key={card.slot} card={card} bookId={bookId} />
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full border px-3 py-1.5 font-ui text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      style={{
        borderColor: active ? "var(--world-accent)" : "var(--world-frame)",
        background: active ? "var(--world-accent)" : "transparent",
        color: active ? "var(--world-accent-fg)" : "var(--foreground)",
      }}
    >
      {label}
    </button>
  );
}

function CodexSkeleton() {
  return (
    <div>
      <p role="status" className="sr-only">
        Loading your discoveries…
      </p>
      <div aria-hidden="true">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="space-y-2">
            <div
              className="h-3 w-24 animate-pulse rounded motion-reduce:animate-none"
              style={{ background: "var(--muted)" }}
            />
            <div
              className="h-3 w-48 animate-pulse rounded motion-reduce:animate-none"
              style={{ background: "var(--muted)" }}
            />
          </div>
          <div
            className="h-14 w-14 animate-pulse rounded-full motion-reduce:animate-none"
            style={{ background: "var(--muted)" }}
          />
        </div>

        <div className="mb-5 flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-8 w-20 animate-pulse rounded-full motion-reduce:animate-none"
              style={{ background: "var(--muted)" }}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[3/4] w-full animate-pulse rounded-lg motion-reduce:animate-none"
              style={{ background: "var(--muted)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
