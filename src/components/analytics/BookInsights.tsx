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

/** min(chunkIdx+1, totalChunks) / totalChunks — the same progress convention getBookStats uses. */
function fractionAlongBook(
  chunkIdx: number,
  totalChunks: number | null,
): number {
  if (!totalChunks || totalChunks <= 0) return 0;
  return Math.min(chunkIdx + 1, totalChunks) / totalChunks;
}

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
          Tap a marked event to jump straight to that page in the reader.
        </p>
        <TimelineSpine bookId={bookId} timeline={insights.timeline} />
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

function TimelineSpine({
  bookId,
  timeline,
}: {
  bookId: string;
  timeline: StoryInsights["timeline"];
}) {
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
          const chunkIdx =
            entry.approxPage != null ? pageToChunkIdx(entry.approxPage) : null;
          const fraction = fractionAlongBook(chunkIdx ?? 0, totalChunks);
          const above = i % 2 === 0;
          return (
            <TimelineMarker
              key={`${entry.label}-${entry.approxPage}-${i}`}
              bookId={bookId}
              entry={entry}
              fraction={fraction}
              above={above}
              chunkIdx={chunkIdx}
            />
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

/**
 * One event marker on the timeline spine. When its page is known (the
 * common case — see StoryInsightTimelineEntry), it's a real link to
 * `/books/{bookId}/read?chunk=N` so a reader can jump back to re-read or
 * ahead to a beat they've already unlocked; the reader route (src/app/(app)/
 * books/[bookId]/read/page.tsx) parses `?chunk=` and hands it to <Reader> as
 * `initialChunk`, which only overrides the STARTING position for this load —
 * the saved frontier is untouched (server-side clamped + never-regressing),
 * so this can never spoil or reset progress. A 44px-square hit box (h-11
 * w-11, flex-centered) keeps the tap target comfortable even though the
 * visible dot stays small. When the page is unknown (only possible in a
 * legacy owner/admin entry — see the DTO doc), it renders as a plain,
 * non-interactive tick, same as before.
 */
function TimelineMarker({
  bookId,
  entry,
  fraction,
  above,
  chunkIdx,
}: {
  bookId: string;
  entry: TimelineEntry;
  fraction: number;
  above: boolean;
  chunkIdx: number | null;
}) {
  const clickable = chunkIdx !== null;

  const titleParts = [entry.label];
  if (entry.summary) titleParts.push(entry.summary);
  if (entry.approxPage != null) titleParts.push(`Page ${entry.approxPage}`);
  const title = titleParts.join(" — ");

  const sharedClassName =
    "group absolute top-1/2 left-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none";

  const inner = (
    <>
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 rounded-full bg-world-accent transition-transform duration-150 group-hover:scale-125"
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 w-24 -translate-x-1/2 truncate text-center font-ui text-[10px] text-muted-foreground ${
          above ? "bottom-full mb-1" : "top-full mt-1"
        }`}
      >
        {entry.label}
      </span>
    </>
  );

  if (clickable) {
    return (
      <Link
        href={`/books/${bookId}/read?chunk=${chunkIdx}`}
        title={title}
        aria-label={`Jump to page ${entry.approxPage}: ${entry.label}`}
        data-sound="press"
        className={`${sharedClassName} cursor-pointer`}
        style={{ left: `${fraction * 100}%` }}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={sharedClassName}
      style={{ left: `${fraction * 100}%` }}
      title={title}
    >
      {inner}
    </div>
  );
}
