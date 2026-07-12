"use client";

import { useCallback, useEffect, useState } from "react";
import type { QueueStatusDto } from "./types";

const POLL_MS = 10_000;

type LoadState = "loading" | "ready" | "error";

/**
 * Live "Background queue" panel for the admin Press Room: what the always-
 * on analysis/illustration sweepers (src/jobs/sweep-analysis.ts,
 * src/jobs/sweep-overlays.ts) are doing right now, how deep the backlog is,
 * free-tier headroom, and recent failures with their real error. Polls
 * /api/admin/queue every ~10s, pausing while the tab is hidden.
 */
export function AdminQueue() {
  const [status, setStatus] = useState<QueueStatusDto | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/queue");
      if (!res.ok) throw new Error("Failed to load queue status");
      const data = (await res.json()) as QueueStatusDto;
      setStatus(data);
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

  if (loadState === "loading") {
    return (
      <div className="mb-10 rounded-lg border border-border bg-card p-4">
        <p className="eyebrow mb-1">Background queue</p>
        <p className="font-ui text-sm text-muted-foreground">
          Checking on the sweepers…
        </p>
      </div>
    );
  }

  if (loadState === "error" || !status) {
    return (
      <div className="mb-10 rounded-lg border border-border bg-card p-4">
        <p className="eyebrow mb-1">Background queue</p>
        <p className="font-ui text-sm text-[var(--destructive)]">
          Couldn&apos;t reach the queue status. Retrying…
        </p>
      </div>
    );
  }

  const {
    processing,
    analysisBacklog,
    analysis,
    illustrations,
    freeTier,
    recentFailures,
  } = status;

  return (
    <div className="mb-10 rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background:
                processing.length > 0
                  ? "var(--world-accent)"
                  : "var(--muted-foreground)",
            }}
          />
          <p className="eyebrow">Background queue</p>
        </div>
        <p className="font-ui text-xs text-muted-foreground">
          Updated {new Date(status.generatedAt).toLocaleTimeString()}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ProcessingCard processing={processing} />
        <BurndownCard
          label="Analysis"
          hint={`${analysisBacklog.pending} pending · ${analysisBacklog.running} running · ${analysisBacklog.failed} failed`}
          done={analysis.analyzed}
          total={analysis.totalReady}
        />
        <BurndownCard
          label="Illustrations"
          hint={`${illustrations.booksWithBacklog} book${illustrations.booksWithBacklog === 1 ? "" : "s"} with a backlog`}
          done={illustrations.readyPages}
          total={illustrations.totalPages}
        />
        <HeadroomGauge freeTier={freeTier} />
      </div>

      <RecentFailures failures={recentFailures} />
    </div>
  );
}

function ProcessingCard({
  processing,
}: {
  processing: QueueStatusDto["processing"];
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="eyebrow mb-2">Processing now</p>
      {processing.length === 0 ? (
        <p className="font-ui text-xs text-muted-foreground">
          Nothing running — the pipe is idle or between ticks.
        </p>
      ) : (
        <ul className="space-y-2">
          {processing.map((p) => (
            <li key={p.jobId}>
              <p
                className="max-w-[16rem] truncate font-display text-sm italic"
                title={p.title}
              >
                {p.title}
              </p>
              <p className="mb-1 truncate font-ui text-[11px] text-muted-foreground">
                {p.stage ?? "Working…"}
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[var(--world-accent)] transition-[width] duration-500"
                  style={{
                    width: `${Math.min(100, Math.max(0, p.progress))}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BurndownCard({
  label,
  hint,
  done,
  total,
}: {
  label: string;
  hint: string;
  done: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="eyebrow mb-2">{label}</p>
      <p className="font-display text-xl">
        {done.toLocaleString()}
        <span className="text-muted-foreground">
          {" "}
          / {total.toLocaleString()}
        </span>
      </p>
      <div className="mt-2 mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[var(--world-accent)] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="font-ui text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function HeadroomGauge({ freeTier }: { freeTier: QueueStatusDto["freeTier"] }) {
  const low = freeTier.headroomPct < 20;
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="eyebrow mb-2">Free-tier headroom</p>
      <p
        className="font-display text-xl"
        style={{ color: low ? "var(--destructive)" : undefined }}
      >
        {freeTier.headroomPct}%
      </p>
      <div className="mt-2 mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(0, Math.min(100, freeTier.headroomPct))}%`,
            background: low ? "var(--destructive)" : "var(--world-accent)",
          }}
        />
      </div>
      <p className="font-ui text-[11px] text-muted-foreground">
        {freeTier.requestsToday.toLocaleString()} /{" "}
        {freeTier.dailyLimit.toLocaleString()} requests today
      </p>
    </div>
  );
}

function RecentFailures({
  failures,
}: {
  failures: QueueStatusDto["recentFailures"];
}) {
  if (failures.length === 0) return null;

  return (
    <div className="mt-4">
      <p className="eyebrow mb-2">Recent failures</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse font-ui text-sm">
          <thead>
            <tr className="text-left">
              {["Title", "Error", "Failed", "Attempts", "Status"].map((h) => (
                <th
                  key={h}
                  className="eyebrow border-b border-border px-3 py-2 font-normal whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {failures.map((f) => (
              <tr
                key={f.jobId}
                className="border-b border-border align-top last:border-b-0"
              >
                <td
                  className="max-w-[180px] truncate px-3 py-2 font-display italic"
                  title={f.title}
                >
                  {f.title}
                </td>
                <td
                  className="max-w-[320px] truncate px-3 py-2 text-muted-foreground"
                  title={f.error ?? ""}
                >
                  {f.error ?? "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {new Date(f.failedAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 tabular-nums">{f.attempts}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {f.willAutoRetry ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{
                        background: "var(--muted)",
                        color: "var(--muted-foreground)",
                      }}
                    >
                      {f.cooldownEndsAt
                        ? `Retries ${new Date(f.cooldownEndsAt).toLocaleTimeString()}`
                        : "Will retry"}
                    </span>
                  ) : (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{
                        background:
                          "color-mix(in srgb, var(--destructive) 16%, transparent)",
                        color: "var(--destructive)",
                      }}
                    >
                      Needs manual retry
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
