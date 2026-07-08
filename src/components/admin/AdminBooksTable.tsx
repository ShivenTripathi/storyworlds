"use client";

import { useState } from "react";
import { ARCHETYPE_META, ARCHETYPES, type Archetype } from "@/theme/archetypes";
import type { AdminBookRow } from "./types";

interface AdminBooksTableProps {
  books: AdminBookRow[];
  onTogglePublish: (bookId: string, next: "published" | "private") => Promise<void>;
  onArchetypeChange: (bookId: string, archetype: Archetype) => Promise<void>;
  onRetry: (bookId: string) => Promise<void>;
}

export function AdminBooksTable({
  books,
  onTogglePublish,
  onArchetypeChange,
  onRetry,
}: AdminBooksTableProps) {
  if (books.length === 0) {
    return (
      <p className="font-ui py-12 text-center text-sm text-muted-foreground">
        No books have been uploaded yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="font-ui w-full border-collapse text-sm">
        <thead>
          <tr className="text-left">
            {["Title", "Owner", "Status", "Visibility", "Archetype", "Overlays", "Spend", "Tokens", ""].map(
              (h) => (
                <th
                  key={h}
                  className="eyebrow border-b border-border px-3 py-2 font-normal whitespace-nowrap"
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {books.map((book) => (
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
  );
}

function BookRow({
  book,
  onTogglePublish,
  onArchetypeChange,
  onRetry,
}: {
  book: AdminBookRow;
  onTogglePublish: (bookId: string, next: "published" | "private") => Promise<void>;
  onArchetypeChange: (bookId: string, archetype: Archetype) => Promise<void>;
  onRetry: (bookId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  const isPublished = book.visibility === "published";

  async function handleToggle() {
    setBusy(true);
    try {
      await onTogglePublish(book.id, isPublished ? "private" : "published");
    } finally {
      setBusy(false);
    }
  }

  async function handleArchetype(e: React.ChangeEvent<HTMLSelectElement>) {
    setBusy(true);
    try {
      await onArchetypeChange(book.id, e.target.value as Archetype);
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    setBusy(true);
    try {
      await onRetry(book.id);
      setConfirmingRetry(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-border align-middle">
      <td className="max-w-[220px] truncate px-3 py-2 font-display italic" title={book.title}>
        {book.title}
      </td>
      <td className="max-w-[180px] truncate px-3 py-2 text-muted-foreground" title={book.owner ?? ""}>
        {book.owner ?? "—"}
      </td>
      <td className="px-3 py-2">{book.status}</td>
      <td className="px-3 py-2">
        <span
          className="rounded-full px-2 py-0.5 text-xs"
          style={{
            background: isPublished ? "var(--world-accent)" : "var(--muted)",
            color: isPublished ? "var(--world-accent-fg)" : "var(--muted-foreground)",
          }}
        >
          {isPublished ? "published" : "private"}
        </span>
      </td>
      <td className="px-3 py-2">
        <select
          value={book.themeArchetype ?? "classic"}
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
      </td>
      <td className="px-3 py-2 tabular-nums">{book.analysis.overlayCount}</td>
      <td className="px-3 py-2 tabular-nums">${book.spendUsd.toFixed(4)}</td>
      <td className="px-3 py-2 tabular-nums">{book.tokens.toLocaleString()}</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
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
      </td>
    </tr>
  );
}
