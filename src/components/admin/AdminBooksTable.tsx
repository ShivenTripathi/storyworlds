"use client";

import { useState } from "react";
import Link from "next/link";
import { ARCHETYPE_META, ARCHETYPES, type Archetype } from "@/theme/archetypes";
import type { AdminBookClass, AdminBookRow } from "./types";

interface AdminBooksTableProps {
  books: AdminBookRow[];
  onTogglePublish: (
    bookId: string,
    next: "published" | "private",
  ) => Promise<void>;
  onArchetypeChange: (bookId: string, archetype: Archetype) => Promise<void>;
  onRetry: (bookId: string) => Promise<void>;
}

const CLASS_META: Record<AdminBookClass, { label: string; hint: string }> = {
  catalog: { label: "Catalog", hint: "Auto-ingested Gutenberg seed" },
  contribution: {
    label: "Contribution",
    hint: "A reader shared this to the public library",
  },
  private: {
    label: "Private",
    hint: "Single-reader — never leaves this admin view or its owner's shelf",
  },
};

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  ready: { bg: "var(--world-accent)", fg: "var(--world-accent-fg)" },
  uploaded: { bg: "var(--muted)", fg: "var(--muted-foreground)" },
  extracting: { bg: "var(--muted)", fg: "var(--muted-foreground)" },
  analyzing: { bg: "var(--muted)", fg: "var(--muted-foreground)" },
  failed: {
    bg: "color-mix(in srgb, var(--destructive) 20%, transparent)",
    fg: "var(--destructive)",
  },
};

function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.uploaded;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {status}
    </span>
  );
}

export function AdminBooksTable({
  books,
  onTogglePublish,
  onArchetypeChange,
  onRetry,
}: AdminBooksTableProps) {
  const [filter, setFilter] = useState<AdminBookClass | "all">("all");

  const counts: Record<AdminBookClass, number> = {
    catalog: 0,
    contribution: 0,
    private: 0,
  };
  for (const b of books) counts[b.bookClass] += 1;

  const filtered =
    filter === "all" ? books : books.filter((b) => b.bookClass === filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterTab
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label={`All (${books.length})`}
        />
        <FilterTab
          active={filter === "catalog"}
          onClick={() => setFilter("catalog")}
          label={`Catalog (${counts.catalog})`}
        />
        <FilterTab
          active={filter === "contribution"}
          onClick={() => setFilter("contribution")}
          label={`Contributions (${counts.contribution})`}
        />
        <FilterTab
          active={filter === "private"}
          onClick={() => setFilter("private")}
          label={`Private (${counts.private})`}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center font-ui text-sm text-muted-foreground">
          {books.length === 0
            ? "No books have been uploaded yet."
            : "Nothing in this filter."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse font-ui text-sm">
            <thead>
              <tr className="text-left">
                {[
                  "Title",
                  "Owner",
                  "Class",
                  "Status",
                  "Visibility",
                  "Archetype",
                  "Overlays",
                  "Spend",
                  "Tokens",
                  "",
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
              {filtered.map((book) => (
                <BookRow
                  key={book.id}
                  book={book}
                  onTogglePublish={onTogglePublish}
                  onArchetypeChange={onArchetypeChange}
                  onRetry={onRetry}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterTab({
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
      onClick={onClick}
      className="rounded-full border px-3 py-1 font-ui text-xs transition-colors duration-150"
      style={
        active
          ? {
              borderColor: "var(--primary)",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
            }
          : { borderColor: "var(--border)", color: "var(--muted-foreground)" }
      }
    >
      {label}
    </button>
  );
}

function BookRow({
  book,
  onTogglePublish,
  onArchetypeChange,
  onRetry,
}: {
  book: AdminBookRow;
  onTogglePublish: (
    bookId: string,
    next: "published" | "private",
  ) => Promise<void>;
  onArchetypeChange: (bookId: string, archetype: Archetype) => Promise<void>;
  onRetry: (bookId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const isPublished = book.visibility === "published";
  const archetype = (book.themeArchetype ?? "classic") as Archetype;

  async function withRowError(action: () => Promise<void>) {
    setBusy(true);
    setRowError(null);
    try {
      await action();
    } catch (e) {
      setRowError(
        e instanceof Error ? e.message : "That action failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle() {
    await withRowError(() =>
      onTogglePublish(book.id, isPublished ? "private" : "published"),
    );
  }

  async function handleArchetype(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Archetype;
    await withRowError(() => onArchetypeChange(book.id, next));
  }

  async function handleRetry() {
    await withRowError(async () => {
      await onRetry(book.id);
      setConfirmingRetry(false);
    });
  }

  const classMeta = CLASS_META[book.bookClass];

  return (
    <tr className="border-b border-border align-middle transition-colors duration-150 last:border-b-0 hover:bg-[var(--muted)]/40">
      <td
        className="max-w-[220px] truncate px-3 py-2 font-display italic"
        title={book.title}
      >
        {book.title}
      </td>
      <td
        className="max-w-[180px] truncate px-3 py-2 text-muted-foreground"
        title={book.owner ?? ""}
      >
        {book.owner ?? "—"}
      </td>
      <td className="px-3 py-2">
        <span
          className="rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
          title={classMeta.hint}
          style={
            book.bookClass === "private"
              ? {
                  background:
                    "color-mix(in srgb, var(--destructive) 16%, transparent)",
                  color: "var(--destructive)",
                }
              : { background: "var(--muted)", color: "var(--muted-foreground)" }
          }
        >
          {book.bookClass === "private" ? "PRIVATE" : classMeta.label}
        </span>
      </td>
      <td className="px-3 py-2">
        <StatusPill status={book.status} />
      </td>
      <td className="px-3 py-2">
        <span
          className="rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
          style={{
            background: isPublished ? "var(--world-accent)" : "var(--muted)",
            color: isPublished
              ? "var(--world-accent-fg)"
              : "var(--muted-foreground)",
          }}
        >
          {isPublished ? "published" : "private"}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            data-world-theme={archetype}
            className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-border/50"
            style={{ background: "var(--world-accent)" }}
            title={ARCHETYPE_META[archetype]?.label ?? archetype}
          />
          <select
            value={archetype}
            onChange={handleArchetype}
            disabled={busy}
            className="rounded border border-border bg-transparent px-1.5 py-1 text-xs disabled:opacity-50"
          >
            {ARCHETYPES.map((a) => (
              <option key={a} value={a}>
                {ARCHETYPE_META[a].label}
              </option>
            ))}
          </select>
        </div>
      </td>
      <td className="px-3 py-2 tabular-nums">{book.analysis.overlayCount}</td>
      <td className="px-3 py-2 tabular-nums">${book.spendUsd.toFixed(2)}</td>
      <td className="px-3 py-2 tabular-nums">{book.tokens.toLocaleString()}</td>
      <td className="px-3 py-2">
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
            <Link
              href={`/books/${book.id}`}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Open
            </Link>
            <Link
              href={`/admin/books/${book.id}`}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Inspect →
            </Link>
            <button
              type="button"
              onClick={handleToggle}
              disabled={busy}
              className="rounded-full border border-border px-2.5 py-1 text-xs disabled:opacity-50"
            >
              {isPublished ? "Unpublish" : "Publish"}
            </button>

            {confirmingRetry ? (
              <span className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Retry?</span>
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={busy}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-[var(--destructive)] disabled:opacity-50"
                >
                  {busy ? "…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRetry(false)}
                  disabled={busy}
                  className="rounded px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRetry(true)}
                disabled={busy}
                className="rounded-full border border-border px-2.5 py-1 text-xs disabled:opacity-50"
              >
                Retry analysis
              </button>
            )}
          </div>
          {rowError ? (
            <p className="max-w-[220px] text-right text-[11px] text-[var(--destructive)]">
              {rowError}
            </p>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
