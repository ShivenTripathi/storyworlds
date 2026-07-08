"use client";

import { useState } from "react";
import type { WorldCounts, WorldEntity } from "./types";

interface CastListProps {
  entities: WorldEntity[];
  counts?: WorldCounts;
  className?: string;
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
  if (k === "faction" || k === "group" || k === "organization") return "faction";
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
    if (list?.length) ordered.push({ key: kind, label: KIND_LABELS[kind], entities: list });
  }
  const other = groups.get("other");
  if (other?.length) ordered.push({ key: "other", label: "OTHERS", entities: other });
  return ordered;
}

/**
 * Entity roster grouped by kind, characters first. Each row expands on
 * click to reveal the deeper "brass plaque" details. Hidden entities
 * (beyond the reader's spoiler frontier) are never named — only counted.
 */
export function CastList({ entities, counts, className = "" }: CastListProps) {
  const groups = groupEntities(entities);
  const hidden = counts && counts.total > counts.visible ? counts.total - counts.visible : 0;

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
              <EntityRow key={entity.id} entity={entity} />
            ))}
          </ul>
        </section>
      ))}

      {hidden > 0 ? (
        <p className="font-ui flex items-center gap-1.5 text-xs text-muted-foreground italic">
          <LockGlyph />
          {hidden} more {hidden === 1 ? "waits" : "await you"} deeper in the story
        </p>
      ) : null}
    </div>
  );
}

function EntityRow({ entity }: { entity: WorldEntity }) {
  const [expanded, setExpanded] = useState(false);
  const { attributes } = entity;
  const hasDetail = Boolean(
    attributes?.internalState || attributes?.keyMotivation || entity.visualDescription || attributes?.scars,
  );

  return (
    <li className="rounded-md border border-transparent hover:border-[var(--world-frame)]">
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        aria-expanded={hasDetail ? expanded : undefined}
        className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <span className="font-display text-base">{entity.name}</span>
        {attributes?.role ? (
          <span className="font-ui line-clamp-1 text-xs text-muted-foreground">
            {attributes.role}
          </span>
        ) : null}
      </button>

      {expanded && hasDetail ? (
        <div className="space-y-2 px-2 pb-3">
          {attributes?.internalState ? (
            <DetailRow label="INTERNAL STATE" value={attributes.internalState} />
          ) : null}
          {attributes?.keyMotivation ? (
            <DetailRow label="KEY MOTIVATION" value={attributes.keyMotivation} />
          ) : null}
          {attributes?.scars ? <DetailRow label="SCARS" value={attributes.scars} /> : null}
          {entity.visualDescription ? (
            <DetailRow label="APPEARANCE" value={entity.visualDescription} />
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

function LockGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
