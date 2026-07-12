"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { pageToChunkIdx } from "@/domain/schemas";

/** Mirrors StoryInsightNode/Edge/StoryInsightsDto (src/services/analytics.ts). */
interface InsightNode {
  id: string;
  name: string;
  kind: string;
  pageCount: number;
  /** First illustrated scene featuring this entity, within the frontier. */
  portraitUrl: string | null;
  /** Up to a few event labels this entity is tied to (frontier-safe). */
  keyEvents: string[];
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
  /** Entities active on this event's page — frontier-safe, ready to name/link. */
  entityIds: string[];
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
const NODE_MIN_R = 9;
const NODE_MAX_R = 26;
// Only the most prominent nodes get a direct text label — the rest stay
// dots/portraits with a hover/focus tooltip, so the graph doesn't turn into
// label soup.
const MAX_DIRECT_LABELS = 8;
// Below this radius a portrait/initial wouldn't read legibly, so small nodes
// stay a plain accent-tinted dot.
const MIN_RADIUS_FOR_INITIAL = 11;

/** Sanitizes an entity id (e.g. `char:paul-atreides`) into a valid SVG id fragment. */
function domId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * Tier-2 story-world insights for a book (docs/analytics-plan.md): a
 * character co-occurrence network (with portrait nodes + weighted, hoverable
 * edges), a screen-time ranked bar list, and a timeline spine marking the
 * reader's position — each already-revealed event links straight back to
 * that page in the reader. Frontier-safe by construction — every field this
 * renders is already gated server-side by getStoryInsights. Fetches
 * GET /api/books/{bookId}/insights.
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
        <p className="mb-3 font-ui text-xs text-muted-foreground">
          Tap an event to jump straight to that page in the reader.
        </p>
        <StorySoFarTimeline bookId={bookId} timeline={insights.timeline} />
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
  const reactId = useId();
  const [hoverEdgeKey, setHoverEdgeKey] = useState<string | null>(null);
  const [pinnedEdgeKey, setPinnedEdgeKey] = useState<string | null>(null);
  const activeEdgeKey = hoverEdgeKey ?? pinnedEdgeKey;

  const layout = useMemo(() => {
    const ordered = [...nodes].sort((a, b) => b.pageCount - a.pageCount);
    const maxPages = Math.max(1, ...ordered.map((n) => n.pageCount));
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

    return { ordered, positions, labeled };
  }, [nodes]);

  const nameById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n.name])),
    [nodes],
  );
  const maxWeight = Math.max(1, ...edges.map((e) => e.weight));
  const activeEdge =
    edges.find((e) => `${e.source}-${e.target}` === activeEdgeKey) ?? null;

  function edgeLabel(edge: InsightEdge): string {
    const a = nameById.get(edge.source) ?? edge.source;
    const b = nameById.get(edge.target) ?? edge.target;
    return `${a} & ${b} share ${edge.weight} ${edge.weight === 1 ? "scene" : "scenes"}`;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-world-frame bg-world-surface p-2">
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="img"
        aria-label={`Character network: ${nodes.length} known characters and places`}
        className="mx-auto block h-auto w-full max-w-[26rem] min-w-[18rem]"
      >
        <defs>
          {layout.ordered
            .filter((n) => n.portraitUrl)
            .map((node) => {
              const pos = layout.positions.get(node.id);
              if (!pos) return null;
              return (
                <clipPath key={node.id} id={domId(`${reactId}-clip`, node.id)}>
                  <circle cx={pos.x} cy={pos.y} r={pos.r} />
                </clipPath>
              );
            })}
        </defs>

        {edges.map((edge) => {
          const a = layout.positions.get(edge.source);
          const b = layout.positions.get(edge.target);
          if (!a || !b) return null;
          const key = `${edge.source}-${edge.target}`;
          const strength = edge.weight / maxWeight;
          const isActive = activeEdgeKey === key;
          const toggle = () =>
            setPinnedEdgeKey((k) => (k === key ? null : key));
          return (
            <g key={key}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={isActive ? "var(--world-accent)" : "var(--world-frame)"}
                strokeWidth={isActive ? 2 + strength * 3 : 1 + strength * 2.5}
                strokeOpacity={isActive ? 0.95 : 0.35 + strength * 0.4}
                strokeLinecap="round"
                pointerEvents="none"
              />
              {/* Wide, transparent hit-path so a thin edge is still easy to
                  hover/tap and reachable via keyboard — the visible line
                  above stays thin and proportional to `weight`. */}
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={16}
                strokeLinecap="round"
                tabIndex={0}
                role="button"
                aria-label={edgeLabel(edge)}
                className="cursor-pointer focus-visible:outline-none"
                onMouseEnter={() => setHoverEdgeKey(key)}
                onMouseLeave={() => setHoverEdgeKey(null)}
                onFocus={() => setHoverEdgeKey(key)}
                onBlur={() => setHoverEdgeKey(null)}
                onClick={toggle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                  }
                }}
              >
                <title>{edgeLabel(edge)}</title>
              </line>
            </g>
          );
        })}

        {layout.ordered.map((node) => {
          const pos = layout.positions.get(node.id);
          if (!pos) return null;
          const showLabel = layout.labeled.has(node.id);
          const showInitial =
            !node.portraitUrl && pos.r >= MIN_RADIUS_FOR_INITIAL;
          const titleText = [
            node.name,
            node.kind,
            `${node.pageCount} ${node.pageCount === 1 ? "page" : "pages"}`,
            node.keyEvents.length
              ? `Key moments: ${node.keyEvents.join(", ")}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <g key={node.id}>
              <title>{titleText}</title>
              {node.portraitUrl ? (
                <>
                  <image
                    href={node.portraitUrl}
                    x={pos.x - pos.r}
                    y={pos.y - pos.r}
                    width={pos.r * 2}
                    height={pos.r * 2}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#${domId(`${reactId}-clip`, node.id)})`}
                  />
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={pos.r}
                    fill="none"
                    stroke="var(--world-accent)"
                    strokeWidth={1.25}
                  />
                </>
              ) : (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={pos.r}
                  fill="color-mix(in srgb, var(--world-accent) 55%, var(--world-surface))"
                  stroke="var(--world-accent)"
                  strokeWidth={1}
                />
              )}
              {showInitial ? (
                <text
                  x={pos.x}
                  y={pos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  pointerEvents="none"
                  className="font-display"
                  fontSize={pos.r}
                  fill="var(--world-accent-fg)"
                >
                  {node.name.trim().charAt(0).toUpperCase()}
                </text>
              ) : null}
              {showLabel ? (
                <text
                  x={pos.x}
                  y={pos.y + pos.r + 11}
                  textAnchor="middle"
                  pointerEvents="none"
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

      <p
        aria-live="polite"
        className="mt-2 min-h-[1.25rem] px-1 font-ui text-xs text-muted-foreground"
      >
        {activeEdge
          ? `${edgeLabel(activeEdge)}.`
          : edges.length > 0
            ? "Hover or tap a connection to see how many scenes two characters share."
            : "No shared scenes yet."}
      </p>
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

/** One row of the story-so-far timeline: a revealed event, the reader's
 * current position, or a run of dim "more ahead" ticks. */
type TimelineRowData =
  | {
      kind: "entry";
      key: string;
      entry: TimelineEntry;
      chunkIdx: number | null;
    }
  | { kind: "position"; key: string; page: number }
  | { kind: "hidden"; key: string; count: number };

/**
 * "Story so far" — a vertical spine of event cards, each showing its label
 * and summary directly (no hover needed), in book order. The reader's
 * current position gets its own marked row; events beyond the frontier are
 * never named — server-side gating (getStoryInsights) already drops them,
 * so `hiddenAheadCount` is rendered as a run of unlabeled, dim ticks. A
 * vertical list rather than a horizontal rail keeps this readable at any
 * width — it stacks naturally on mobile with no separate layout needed.
 */
function StorySoFarTimeline({
  bookId,
  timeline,
}: {
  bookId: string;
  timeline: StoryInsights["timeline"];
}) {
  const { entries, hiddenAheadCount, frontierChunk } = timeline;

  if (entries.length === 0 && hiddenAheadCount === 0) {
    return (
      <p className="font-ui text-xs text-muted-foreground italic">
        No plot beats placed yet.
      </p>
    );
  }

  // Entries are already frontier-gated server-side, so every one of them
  // sits at or before the reader's current position — order them by page
  // so the spine reads top-to-bottom the way the book does, then place the
  // position marker after the last of them.
  const ordered = [...entries].sort((a, b) => {
    if (a.approxPage == null) return b.approxPage == null ? 0 : 1;
    if (b.approxPage == null) return -1;
    return a.approxPage - b.approxPage;
  });
  const frontierPage = frontierChunk != null ? frontierChunk + 1 : null;

  const rows: TimelineRowData[] = [
    ...ordered.map((entry, i) => ({
      kind: "entry" as const,
      key: `${entry.label}-${entry.approxPage}-${i}`,
      entry,
      chunkIdx:
        entry.approxPage != null ? pageToChunkIdx(entry.approxPage) : null,
    })),
    ...(frontierPage != null
      ? [{ kind: "position" as const, key: "position", page: frontierPage }]
      : []),
    ...(hiddenAheadCount > 0
      ? [{ kind: "hidden" as const, key: "hidden", count: hiddenAheadCount }]
      : []),
  ];

  return (
    <ol className="flex flex-col">
      {rows.map((row, i) => (
        <TimelineRow
          key={row.key}
          isLast={i === rows.length - 1}
          tone={
            row.kind === "position"
              ? "accent"
              : row.kind === "hidden"
                ? "dim"
                : "default"
          }
        >
          {row.kind === "entry" ? (
            <TimelineCard
              bookId={bookId}
              entry={row.entry}
              chunkIdx={row.chunkIdx}
            />
          ) : row.kind === "position" ? (
            <div className="flex items-center gap-2 py-1.5">
              <p className="font-ui text-[11px] font-semibold tracking-wide text-primary uppercase">
                You are here
              </p>
              <span className="font-ui text-[11px] text-muted-foreground tabular-nums">
                page {row.page}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-1.5">
              <span className="flex gap-1" aria-hidden="true">
                {Array.from({ length: Math.min(row.count, 5) }).map((_, j) => (
                  <span
                    key={j}
                    className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40"
                  />
                ))}
              </span>
              <p className="font-ui text-xs text-muted-foreground italic">
                {row.count} more {row.count === 1 ? "event" : "events"} still
                ahead.
              </p>
            </div>
          )}
        </TimelineRow>
      ))}
    </ol>
  );
}

/** One row's rail: a dot on the spine plus the connecting line down to the
 * next row (omitted for the last row, so the spine doesn't trail past it). */
function TimelineRow({
  isLast,
  tone = "default",
  children,
}: {
  isLast: boolean;
  tone?: "default" | "accent" | "dim";
  children: React.ReactNode;
}) {
  const dotClassName =
    tone === "accent"
      ? "bg-primary"
      : tone === "dim"
        ? "bg-muted-foreground/40"
        : "bg-world-accent";

  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-x-3">
      <div className="relative flex justify-center" aria-hidden="true">
        {!isLast ? (
          <span className="absolute top-3 bottom-0 w-px bg-world-frame" />
        ) : null}
        <span
          className={`relative z-10 mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${dotClassName}`}
        />
      </div>
      <div className="min-w-0 pb-4">{children}</div>
    </li>
  );
}

/**
 * One revealed event, shown with its label and summary directly — not
 * hidden behind a hover tooltip. When its page is known (the common case —
 * see StoryInsightTimelineEntry), the whole card is a real link to
 * `/books/{bookId}/read?chunk=N` so a reader can jump back to re-read or
 * ahead to a beat they've already unlocked; the reader route (src/app/(app)/
 * books/[bookId]/read/page.tsx) parses `?chunk=` and hands it to <Reader> as
 * `initialChunk`, which only overrides the STARTING position for this load —
 * the saved frontier is untouched (server-side clamped + never-regressing),
 * so this can never spoil or reset progress. When the page is unknown (only
 * possible in a legacy owner/admin entry — see the DTO doc), it renders as a
 * plain, non-interactive card.
 */
function TimelineCard({
  bookId,
  entry,
  chunkIdx,
}: {
  bookId: string;
  entry: TimelineEntry;
  chunkIdx: number | null;
}) {
  const content = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-sm leading-snug text-foreground">
          {entry.label}
        </p>
        {entry.approxPage != null ? (
          <span className="shrink-0 font-ui text-[11px] text-muted-foreground tabular-nums">
            p.{entry.approxPage}
          </span>
        ) : null}
      </div>
      {entry.summary ? (
        <p className="mt-1 line-clamp-2 font-reading text-xs leading-relaxed text-muted-foreground">
          {entry.summary}
        </p>
      ) : null}
      {chunkIdx !== null ? (
        <span className="mt-1.5 inline-flex items-center gap-1 font-ui text-[10px] font-medium text-world-accent">
          Jump to page <span aria-hidden="true">→</span>
        </span>
      ) : null}
    </>
  );

  if (chunkIdx !== null) {
    return (
      <Link
        href={`/books/${bookId}/read?chunk=${chunkIdx}`}
        aria-label={`Jump to page ${entry.approxPage}: ${entry.label}`}
        data-sound="press"
        className="block rounded-md border border-world-frame bg-world-surface px-3 py-2 transition-colors hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-md border border-world-frame bg-world-surface px-3 py-2 opacity-80">
      {content}
    </div>
  );
}
