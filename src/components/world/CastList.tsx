"use client";

import Link from "next/link";
import { useState } from "react";
import { ProgressChip } from "./ProgressChip";
import type { WorldCounts, WorldEntity } from "./types";

interface CastListProps {
  entities: WorldEntity[];
  counts?: WorldCounts;
  className?: string;
  /** Enables "Dossier →" links (and, with `onChat`, chat buttons) — omitted callers just get the plain roster. */
  bookId?: string;
  /** When provided, character rows get a quiet "Chat" button that calls this with the entity id. */
  onChat?: (entityId: string) => void;
}

const KIND_ORDER = ["character", "place", "object", "faction"] as const;

const KIND_LABELS: Record<(typeof KIND_ORDER)[number], string> = {
  character: "CHARACTERS",
  place: "PLACES",
  object: "OBJECTS",
  faction: "FACTIONS",
};

/** Normalizes server-provided `kind` strings (singular or plural) to a canonical bucket. */
function normalizeKind(kind: string): (typeof KIND_ORDER)[number] | "other" {
  const k = kind.toLowerCase().replace(/s$/, "");
  if (k === "character" || k === "person") return "character";
  if (k === "place" || k === "location") return "place";
  if (k === "object" || k === "item") return "object";
  if (k === "faction" || k === "group" || k === "organization")
    return "faction";
  return "other";
}

function groupEntities(entities: WorldEntity[]) {
  const groups = new Map<string, WorldEntity[]>();
  for (const entity of entities) {
    const bucket = normalizeKind(entity.kind);
    const list = groups.get(bucket) ?? [];
    list.push(entity);
    groups.set(bucket, list);
  }
  const ordered: { key: string; label: string; entities: WorldEntity[] }[] = [];
  for (const kind of KIND_ORDER) {
    const list = groups.get(kind);
    if (list?.length)
      ordered.push({ key: kind, label: KIND_LABELS[kind], entities: list });
  }
  const other = groups.get("other");
  if (other?.length)
    ordered.push({ key: "other", label: "OTHERS", entities: other });
  return ordered;
}

/**
 * Entity roster grouped by kind, characters first. Each row expands on
 * click to reveal the deeper "brass plaque" details. Hidden entities
 * (beyond the reader's spoiler frontier) are never named — only counted.
 */
export function CastList({
  entities,
  counts,
  className = "",
  bookId,
  onChat,
}: CastListProps) {
  const groups = groupEntities(entities);
  const hidden =
    counts && counts.total > counts.visible ? counts.total - counts.visible : 0;

  if (groups.length === 0 && hidden === 0) {
    return (
      <p className="font-ui text-sm text-muted-foreground italic">
        No one has stepped into the light yet.
      </p>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {groups.map((group) => (
        <section key={group.key}>
          <p className="eyebrow mb-2">{group.label}</p>
          <ul className="space-y-1">
            {group.entities.map((entity) => (
              <EntityRow
                key={entity.id}
                entity={entity}
                bookId={bookId}
                onChat={group.key === "character" ? onChat : undefined}
              />
            ))}
          </ul>
        </section>
      ))}

      {hidden > 0 ? (
        <p className="flex items-center gap-1.5 font-ui text-xs text-muted-foreground italic">
          <LockGlyph />
          {hidden} more {hidden === 1 ? "waits" : "await you"} deeper in the
          story
        </p>
      ) : null}
    </div>
  );
}

function EntityRow({
  entity,
  bookId,
  onChat,
}: {
  entity: WorldEntity;
  bookId?: string;
  onChat?: (entityId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { attributes } = entity;
  const hasDetail = Boolean(
    attributes?.internalState ||
    attributes?.keyMotivation ||
    entity.visualDescription ||
    attributes?.scars,
  );
  const expandable = hasDetail || Boolean(bookId);

  return (
    <li className="rounded-md border border-transparent hover:border-[var(--world-frame)]">
      <button
        type="button"
        onClick={() => expandable && setExpanded((v) => !v)}
        aria-expanded={expandable ? expanded : undefined}
        disabled={!expandable}
        className="flex w-full items-start justify-between gap-2 rounded-md px-2 py-2 text-left focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:cursor-default"
      >
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className="min-w-0 font-display text-base break-words"
              title={entity.name}
            >
              {entity.name}
            </span>
            <ProgressChip introducedAtChunk={entity.introducedAtChunk} />
          </span>
          {attributes?.role ? (
            <span className="line-clamp-1 font-ui text-xs text-muted-foreground">
              {attributes.role}
            </span>
          ) : null}
        </span>
        {expandable ? (
          <ChevronGlyph
            className={`mt-1.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${
              expanded ? "rotate-90" : ""
            }`}
          />
        ) : null}
      </button>

      {expanded && expandable ? (
        <div className="space-y-2 px-2 pb-3">
          {attributes?.internalState ? (
            <DetailRow
              label="INTERNAL STATE"
              value={attributes.internalState}
            />
          ) : null}
          {attributes?.keyMotivation ? (
            <DetailRow
              label="KEY MOTIVATION"
              value={attributes.keyMotivation}
            />
          ) : null}
          {attributes?.scars ? (
            <DetailRow label="SCARS" value={attributes.scars} />
          ) : null}
          {entity.visualDescription ? (
            <DetailRow label="APPEARANCE" value={entity.visualDescription} />
          ) : null}

          {bookId || onChat ? (
            <div className="flex items-center gap-3 pt-1">
              {bookId ? (
                <Link
                  href={`/books/${bookId}/characters/${entity.id}`}
                  className="font-ui text-xs font-medium underline decoration-dotted underline-offset-2"
                  style={{ color: "var(--world-accent)" }}
                >
                  Dossier →
                </Link>
              ) : null}
              {onChat ? (
                <button
                  type="button"
                  onClick={() => onChat(entity.id)}
                  className="font-ui text-xs font-medium underline decoration-dotted underline-offset-2"
                  style={{ color: "var(--world-accent)" }}
                >
                  Chat
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow mb-0.5">{label}</p>
      <p className="font-ui text-sm text-[var(--card-foreground)]">{value}</p>
    </div>
  );
}

function ChevronGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M6 3l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        x="3.5"
        y="7"
        width="9"
        height="6.5"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
