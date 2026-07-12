"use client";

import { useEffect, useMemo, useState } from "react";

/** Mirrors StoryInsightNode/Edge/StoryInsightsDto (src/services/analytics.ts). */
interface InsightNode {
  id: string;
  name: string;
  kind: string;
  pageCount: number;
}
interface InsightEdge {
  source: string;
  target: string;
  weight: number;
}
interface TimelineEntry {
  label: string;
  summary: string;
  approxPage: number | null;
}
interface StoryInsights {
  status: string;
  network: { nodes: InsightNode[]; edges: InsightEdge[] };
  screenTime: InsightNode[];
  timeline: {
    entries: TimelineEntry[];
    totalCount: number;
    hiddenAheadCount: number;
    frontierChunk: number | null;
    totalChunks: number | null;
  };
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; insights: StoryInsights };

// Network diagram geometry — a simple circular ("force-free") layout, no
// physics simulation needed for a book's cast size.
const VIEW = 320;
const CENTER = VIEW / 2;
const LAYOUT_RADIUS = 118;
const NODE_MIN_R = 5;
const NODE_MAX_R = 20;
// Only the most prominent nodes get a direct text label — the rest stay
// dots with a hover/focus tooltip, so the graph doesn't turn into label soup.
const MAX_DIRECT_LABELS = 8;

/** min(chunkIdx+1, totalChunks) / totalChunks — the same progress convention getBookStats uses. */
function fractionAlongBook(
  chunkIdx: number,
  totalChunks: number | null,
): number {
  if (!totalChunks || totalChunks <= 0) return 0;
  return Math.min(chunkIdx + 1, totalChunks) / totalChunks;
}

/**
 * Tier-2 story-world insights for a book (docs/analytics-plan.md): a
 * character co-occurrence network, a screen-time ranked bar list, and a
 * timeline spine marking the reader's position. Frontier-safe by
 * construction — every field this renders is already gated server-side by
 * getStoryInsights. Fetches GET /api/books/{bookId}/insights.
 */
export function BookInsights({
  bookId,
  className = "",
}: {
  bookId: string;
  className?: string;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/books/${bookId}/insights`, { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        return res.json() as Promise<{ insights: StoryInsights }>;
      })
      .then(({ insights }) => {
        if (!cancelled) setState({ status: "ready", insights });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (state.status === "loading") {
    return (
      <div className={`space-y-3 ${className}`} aria-busy="true">
        <div className="h-64 animate-pulse rounded-lg border border-world-frame bg-world-surface" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <p
        className={`font-ui text-sm text-muted-foreground italic ${className}`}
      >
        Couldn&rsquo;t load this book&rsquo;s story insights — try again
        shortly.
      </p>
    );
  }

  const { insights } = state;

  if (insights.status !== "completed") {
    return (
      <p
        className={`font-ui text-sm text-muted-foreground italic ${className}`}
      >
        Story insights unlock once this book has been analyzed.
      </p>
    );
  }

  if (insights.network.nodes.length === 0) {
    return (
      <p
        className={`font-ui text-sm text-muted-foreground italic ${className}`}
      >
        Keep reading — insights unlock as you meet the cast.
      </p>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <section>
        <p className="eyebrow mb-3">Character network</p>
        <CharacterNetwork
          nodes={insights.network.nodes}
          edges={insights.network.edges}
        />
      </section>

      <section>
        <p className="eyebrow mb-3">Screen time</p>
        <ScreenTimeList nodes={insights.screenTime} />
      </section>

      <section>
        <p className="eyebrow mb-3">Story so far</p>
        <TimelineSpine timeline={insights.timeline} />
      </section>
    </div>
  );
}

function CharacterNetwork({
  nodes,
  edges,
}: {
  nodes: InsightNode[];
  edges: InsightEdge[];
}) {
  const layout = useMemo(() => {
    const ordered = [...nodes].sort((a, b) => b.pageCount - a.pageCount);
    const maxPages = Math.max(1, ...ordered.map((n) => n.pageCount));
    const maxWeight = Math.max(1, ...edges.map((e) => e.weight));
    const positions = new Map<string, { x: number; y: number; r: number }>();

    ordered.forEach((node, i) => {
      const angle = (i / ordered.length) * Math.PI * 2 - Math.PI / 2;
      const x = CENTER + LAYOUT_RADIUS * Math.cos(angle);
      const y = CENTER + LAYOUT_RADIUS * Math.sin(angle);
      const r =
        NODE_MIN_R + (NODE_MAX_R - NODE_MIN_R) * (node.pageCount / maxPages);
      positions.set(node.id, { x, y, r });
    });

    const labeled = new Set(
      ordered.slice(0, MAX_DIRECT_LABELS).map((n) => n.id),
    );

    return { ordered, positions, labeled, maxWeight };
  }, [nodes, edges]);

  return (
    <div className="overflow-x-auto rounded-lg border border-world-frame bg-world-surface p-2">
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="img"
        aria-label={`Character network: ${nodes.length} known characters and places`}
        className="mx-auto block h-auto w-full max-w-[26rem] min-w-[18rem]"
      >
        {edges.map((edge) => {
          const a = layout.positions.get(edge.source);
          const b = layout.positions.get(edge.target);
          if (!a || !b) return null;
          const strength = edge.weight / layout.maxWeight;
          return (
            <line
              key={`${edge.source}-${edge.target}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--world-frame)"
              strokeWidth={1 + strength * 2.5}
              strokeOpacity={0.35 + strength * 0.4}
              strokeLinecap="round"
            />
          );
        })}

        {layout.ordered.map((node) => {
          const pos = layout.positions.get(node.id);
          if (!pos) return null;
          const showLabel = layout.labeled.has(node.id);
          return (
            <g key={node.id}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={pos.r}
                fill="color-mix(in srgb, var(--world-accent) 55%, var(--world-surface))"
                stroke="var(--world-accent)"
                strokeWidth={1}
              >
                <title>
                  {node.name} · {node.kind} · {node.pageCount}{" "}
                  {node.pageCount === 1 ? "page" : "pages"}
                </title>
              </circle>
              {showLabel ? (
                <text
                  x={pos.x}
                  y={pos.y + pos.r + 11}
                  textAnchor="middle"
                  className="font-ui"
                  fontSize={9.5}
                  fill="var(--muted-foreground)"
                >
                  {node.name.length > 16
                    ? `${node.name.slice(0, 15)}…`
                    : node.name}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ScreenTimeList({ nodes }: { nodes: InsightNode[] }) {
  if (nodes.length === 0) return null;
  const maxPages = Math.max(1, ...nodes.map((n) => n.pageCount));

  return (
    <ul className="space-y-2">
      {nodes.map((node) => {
        const pct = Math.max(2, Math.round((node.pageCount / maxPages) * 100));
        return (
          <li key={node.id} className="flex items-center gap-3">
            <span className="w-24 shrink-0 truncate font-ui text-xs text-foreground sm:w-32">
              {node.name}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-world-accent"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-10 shrink-0 text-right font-ui text-xs text-muted-foreground tabular-nums">
              {node.pageCount}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TimelineSpine({ timeline }: { timeline: StoryInsights["timeline"] }) {
  const { entries, hiddenAheadCount, frontierChunk, totalChunks } = timeline;

  if (entries.length === 0 && hiddenAheadCount === 0) {
    return (
      <p className="font-ui text-xs text-muted-foreground italic">
        No plot beats placed yet.
      </p>
    );
  }

  const frontierFraction =
    frontierChunk !== null
      ? fractionAlongBook(frontierChunk, totalChunks)
      : null;

  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-[20rem] pt-6 pb-8">
        {/* the spine */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-world-frame" />

        {entries.map((entry, i) => {
          const chunkIdx = (entry.approxPage ?? 1) - 1;
          const fraction = fractionAlongBook(chunkIdx, totalChunks);
          const above = i % 2 === 0;
          return (
            <div
              key={`${entry.label}-${entry.approxPage}-${i}`}
              className="absolute top-1/2"
              style={{ left: `${fraction * 100}%` }}
            >
              <span className="absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-world-accent" />
              <span
                className={`absolute left-1/2 w-24 -translate-x-1/2 truncate text-center font-ui text-[10px] text-muted-foreground ${
                  above ? "bottom-3" : "top-3"
                }`}
                title={entry.summary}
              >
                {entry.label}
              </span>
            </div>
          );
        })}

        {hiddenAheadCount > 0 ? (
          <div
            className="absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-1"
            aria-label={`${hiddenAheadCount} more ${hiddenAheadCount === 1 ? "event" : "events"} ahead`}
            title={`${hiddenAheadCount} more ${hiddenAheadCount === 1 ? "event" : "events"} ahead`}
          >
            {Array.from({ length: Math.min(hiddenAheadCount, 5) }).map(
              (_, i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40"
                  aria-hidden="true"
                />
              ),
            )}
          </div>
        ) : null}

        {frontierFraction !== null ? (
          <div
            className="absolute top-0 bottom-0 w-px bg-primary"
            style={{ left: `${frontierFraction * 100}%` }}
          >
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-ui text-[9px] tracking-wide whitespace-nowrap text-primary uppercase">
              You
            </span>
          </div>
        ) : null}
      </div>

      {hiddenAheadCount > 0 ? (
        <p className="font-ui text-xs text-muted-foreground italic">
          {hiddenAheadCount} more {hiddenAheadCount === 1 ? "event" : "events"}{" "}
          still ahead.
        </p>
      ) : null}
    </div>
  );
}
