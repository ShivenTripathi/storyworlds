"use client";

import { useEffect, useMemo, useState } from "react";

/** Mirrors AdminMetricsDto (src/services/analytics.ts). */
interface AdminMetrics {
  costByBookDay: {
    bookId: string | null;
    day: string;
    costUsd: number;
    tokens: number;
  }[];
  totalSpendUsd: number;
  amortizationRatio: number;
  freeTier: { requestsToday: number; dailyLimit: number; headroomPct: number };
  engagement: {
    booksOpened: number;
    chatMessagesTotal: number;
    completionRatePct: number;
  };
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; metrics: AdminMetrics };

// Below this headroom, the free-tier gauge switches to the destructive
// token — the zero-cost constraint (CLAUDE.md) means running out of Gemini
// free-tier requests is an operational incident, not a cosmetic detail.
const HEADROOM_WARN_PCT = 20;

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/**
 * The admin "Press Room" (docs/analytics-plan.md Tier 3): engagement, LLM
 * cost/amortization, and Gemini free-tier headroom. Fetches
 * GET /api/admin/metrics. Aggregate-only, admin-gated server-side — never
 * renders per-user or per-entity data.
 */
export function AdminMetrics({ className = "" }: { className?: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/metrics", { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        return res.json() as Promise<{ metrics: AdminMetrics }>;
      })
      .then(({ metrics }) => {
        if (!cancelled) setState({ status: "ready", metrics });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className={`space-y-3 ${className}`} aria-busy="true">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-border bg-card"
            />
          ))}
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <p
        className={`font-ui text-sm text-muted-foreground italic ${className}`}
      >
        Couldn&rsquo;t load admin metrics — try again shortly.
      </p>
    );
  }

  const { metrics } = state;
  const headroomCritical = metrics.freeTier.headroomPct < HEADROOM_WARN_PCT;

  return (
    <div className={`space-y-6 ${className}`}>
      <div>
        <p className="eyebrow mb-3">Engagement</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            label="Books opened"
            value={formatCount(metrics.engagement.booksOpened)}
          />
          <StatTile
            label="Chat messages"
            value={formatCount(metrics.engagement.chatMessagesTotal)}
          />
          <StatTile
            label="Completion rate"
            value={`${metrics.engagement.completionRatePct}%`}
          />
        </div>
      </div>

      <div>
        <p className="eyebrow mb-3">Cost &amp; amortization</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            label="Total spend"
            value={formatUsd(metrics.totalSpendUsd)}
          />
          <StatTile
            label="Amortization ratio"
            value={metrics.amortizationRatio.toFixed(2)}
            detail="readers per analyzed book"
          />
          <FreeTierGauge
            requestsToday={metrics.freeTier.requestsToday}
            dailyLimit={metrics.freeTier.dailyLimit}
            headroomPct={metrics.freeTier.headroomPct}
            critical={headroomCritical}
          />
        </div>
      </div>

      <div>
        <p className="eyebrow mb-3">Daily spend</p>
        <CostByDayChart rows={metrics.costByBookDay} />
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="eyebrow mb-1">{label}</p>
      <p className="font-display text-2xl text-foreground tabular-nums">
        {value}
      </p>
      {detail ? (
        <p className="mt-1 font-ui text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

function FreeTierGauge({
  requestsToday,
  dailyLimit,
  headroomPct,
  critical,
}: {
  requestsToday: number;
  dailyLimit: number;
  headroomPct: number;
  critical: boolean;
}) {
  const usedPct = Math.max(0, Math.min(100, 100 - headroomPct));
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="eyebrow mb-1">Free-tier headroom</p>
      <p className="font-display text-2xl text-foreground tabular-nums">
        {headroomPct}%
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${critical ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${usedPct}%` }}
        />
      </div>
      <p className="mt-1 font-ui text-xs text-muted-foreground tabular-nums">
        {formatCount(requestsToday)} / {formatCount(dailyLimit)} req today
      </p>
    </div>
  );
}

function CostByDayChart({ rows }: { rows: AdminMetrics["costByBookDay"] }) {
  const byDay = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      totals.set(row.day, (totals.get(row.day) ?? 0) + row.costUsd);
    }
    return [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, costUsd]) => ({ day, costUsd }));
  }, [rows]);

  if (byDay.length === 0) {
    return (
      <p className="font-ui text-xs text-muted-foreground italic">
        No LLM spend recorded yet.
      </p>
    );
  }

  const maxCost = Math.max(...byDay.map((d) => d.costUsd), 0.0001);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card p-4">
      <div
        className="flex min-w-[24rem] items-end gap-1.5"
        style={{ height: "8rem" }}
        role="img"
        aria-label={`Daily LLM spend over ${byDay.length} days, totaling ${formatUsd(
          byDay.reduce((sum, d) => sum + d.costUsd, 0),
        )}`}
      >
        {byDay.map((d) => {
          const heightPct = Math.max(3, (d.costUsd / maxCost) * 100);
          return (
            <div
              key={d.day}
              className="group relative flex min-w-[10px] flex-1 items-end"
              style={{ height: "100%" }}
            >
              <div
                className="w-full rounded-t-sm bg-primary"
                style={{ height: `${heightPct}%` }}
                title={`${d.day}: ${formatUsd(d.costUsd)}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-ui text-[10px] text-muted-foreground">
        <span>{byDay[0].day}</span>
        <span>{byDay[byDay.length - 1].day}</span>
      </div>
    </div>
  );
}
