"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  FeedbackKind,
  FeedbackListResponse,
  FeedbackRow,
  FeedbackStatus,
} from "./types";

type LoadState = "loading" | "ready" | "error";

const KIND_LABEL: Record<FeedbackKind, string> = {
  praise: "Praise",
  idea: "Idea",
  bug: "Bug",
  general: "General",
};

const KIND_TONE: Record<FeedbackKind, { bg: string; fg: string }> = {
  praise: { bg: "var(--world-accent)", fg: "var(--world-accent-fg)" },
  idea: { bg: "var(--muted)", fg: "var(--muted-foreground)" },
  bug: {
    bg: "color-mix(in srgb, var(--destructive) 18%, transparent)",
    fg: "var(--destructive)",
  },
  general: { bg: "var(--muted)", fg: "var(--muted-foreground)" },
};

const STATUSES: FeedbackStatus[] = ["new", "triaged", "resolved"];
const KINDS: FeedbackKind[] = ["praise", "idea", "bug", "general"];

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Admin feedback review surface: fetches /api/admin/feedback, shows a
 * summary strip (counts by kind + sentiment), status/kind filter chips, and
 * a dense table of feedback rows with the traced pathname/book, submitter
 * email, and a status selector + admin note that PATCH on change.
 */
export function AdminFeedback() {
  const [data, setData] = useState<FeedbackListResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "all">(
    "all",
  );
  const [kindFilter, setKindFilter] = useState<FeedbackKind | "all">("all");

  const load = useCallback(async (status: string, kind: string) => {
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (kind !== "all") params.set("kind", kind);
      const qs = params.toString();
      const res = await fetch(`/api/admin/feedback${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to load feedback");
      const body = (await res.json()) as FeedbackListResponse;
      setData(body);
      setLoadState("ready");
    } catch {
      setLoadState((prev) => (prev === "ready" ? prev : "error"));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load(statusFilter, kindFilter);
    })();
  }, [load, statusFilter, kindFilter]);

  async function handleUpdate(
    id: string,
    updates: { status?: FeedbackStatus; adminNote?: string },
  ) {
    const res = await fetch(`/api/admin/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? "That update failed.");
    }
    await load(statusFilter, kindFilter);
  }

  if (loadState === "loading") {
    return (
      <p className="py-12 text-center font-ui text-sm text-muted-foreground">
        Gathering feedback…
      </p>
    );
  }

  if (loadState === "error" || !data) {
    return (
      <p className="py-12 text-center font-ui text-sm text-[var(--destructive)]">
        Couldn&apos;t load feedback. Try refreshing.
      </p>
    );
  }

  const { items, counts } = data;

  return (
    <div>
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {KINDS.map((k) => (
          <div key={k} className="rounded-lg border border-border bg-card p-4">
            <p className="eyebrow mb-1">{KIND_LABEL[k]}</p>
            <p className="font-display text-2xl">
              {counts.byKind[k].toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-4">
        <div>
          <p className="eyebrow mb-1">Sentiment</p>
          <p className="font-ui text-sm text-muted-foreground">
            <span aria-hidden="true">👍</span> {counts.bySentiment.up} ·{" "}
            <span aria-hidden="true">👎</span> {counts.bySentiment.down} · no
            reaction {counts.bySentiment.none}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <ChipGroup
          label="Status"
          active={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All" },
            ...STATUSES.map((s) => ({ value: s, label: s })),
          ]}
        />
        <ChipGroup
          label="Kind"
          active={kindFilter}
          onChange={setKindFilter}
          options={[
            { value: "all", label: "All" },
            ...KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
          ]}
        />
      </div>

      {items.length === 0 ? (
        <p className="py-12 text-center font-ui text-sm text-muted-foreground">
          Nothing in this filter.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse font-ui text-sm">
            <thead>
              <tr className="text-left">
                {[
                  "Kind",
                  "Feel",
                  "Message",
                  "Traced from",
                  "Submitted by",
                  "When",
                  "Status",
                  "Admin note",
                ].map((h) => (
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
              {items.map((item) => (
                <FeedbackRowView
                  key={item.id}
                  item={item}
                  onUpdate={handleUpdate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChipGroup<T extends string>({
  label,
  active,
  onChange,
  options,
}: {
  label: string;
  active: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-ui text-xs text-muted-foreground">{label}:</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className="rounded-full border px-3 py-1 font-ui text-xs capitalize transition-colors duration-150"
          style={
            active === opt.value
              ? {
                  borderColor: "var(--primary)",
                  background: "var(--primary)",
                  color: "var(--primary-foreground)",
                }
              : {
                  borderColor: "var(--border)",
                  color: "var(--muted-foreground)",
                }
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function FeedbackRowView({
  item,
  onUpdate,
}: {
  item: FeedbackRow;
  onUpdate: (
    id: string,
    updates: { status?: FeedbackStatus; adminNote?: string },
  ) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [note, setNote] = useState(item.adminNote ?? "");
  const tone = KIND_TONE[item.kind];
  const bookId = item.context?.bookId;

  async function withRowError(action: () => Promise<void>) {
    setBusy(true);
    setRowError(null);
    try {
      await action();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "That update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const status = e.target.value as FeedbackStatus;
    await withRowError(() => onUpdate(item.id, { status }));
  }

  async function handleNoteBlur() {
    if (note === (item.adminNote ?? "")) return;
    await withRowError(() => onUpdate(item.id, { adminNote: note }));
  }

  return (
    <tr className="border-b border-border align-top transition-colors duration-150 last:border-b-0 hover:bg-[var(--muted)]/40">
      <td className="px-3 py-2">
        <span
          className="rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
          style={{ background: tone.bg, color: tone.fg }}
        >
          {KIND_LABEL[item.kind]}
        </span>
      </td>
      <td
        className="px-3 py-2 text-center"
        aria-label={
          item.sentiment === "up"
            ? "Thumbs up"
            : item.sentiment === "down"
              ? "Thumbs down"
              : "No reaction"
        }
      >
        <span aria-hidden="true">
          {item.sentiment === "up"
            ? "👍"
            : item.sentiment === "down"
              ? "👎"
              : "—"}
        </span>
      </td>
      <td className="max-w-[320px] min-w-[220px] px-3 py-2 whitespace-pre-wrap">
        {item.message}
      </td>
      <td className="max-w-[180px] px-3 py-2 text-muted-foreground">
        <span className="block truncate" title={item.pathname ?? undefined}>
          {item.pathname ?? "—"}
        </span>
        {bookId ? (
          <Link
            href={`/admin/books/${bookId}`}
            className="mt-0.5 block truncate text-xs text-[var(--primary)] hover:underline"
            title={bookId}
          >
            book: {bookId}
          </Link>
        ) : null}
      </td>
      <td
        className="max-w-[180px] truncate px-3 py-2 text-muted-foreground"
        title={item.userEmail ?? item.userId}
      >
        {item.userEmail ?? item.userId}
      </td>
      <td
        className="px-3 py-2 whitespace-nowrap text-muted-foreground"
        title={new Date(item.createdAt).toLocaleString()}
      >
        {relativeTime(item.createdAt)}
      </td>
      <td className="px-3 py-2">
        <select
          value={item.status}
          onChange={handleStatusChange}
          disabled={busy}
          aria-label={`Status for feedback from ${item.userEmail ?? item.userId}`}
          className="rounded border border-border bg-transparent px-1.5 py-1 text-xs capitalize disabled:opacity-50"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {rowError ? (
          <p className="mt-1 max-w-[140px] text-[11px] text-[var(--destructive)]">
            {rowError}
          </p>
        ) : null}
      </td>
      <td className="min-w-[180px] px-3 py-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={handleNoteBlur}
          disabled={busy}
          rows={2}
          placeholder="Internal note…"
          aria-label={`Admin note for feedback from ${item.userEmail ?? item.userId}`}
          className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-[var(--ring)] disabled:opacity-50"
        />
      </td>
    </tr>
  );
}
