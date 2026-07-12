"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  BookDebug,
  DebugAnomaly,
  DebugEntity,
  DebugOverlay,
} from "@/services/admin-debug";

/**
 * Admin book inspector (see src/services/admin-debug.ts). Dense, utilitarian
 * EX LIBRIS surface — hairline tables, monospace ids/slugs/JSON, semantic
 * color for pipeline anomalies. Read-only; never rendered to non-admins.
 */
export function BookDebugView({ data }: { data: BookDebug }) {
  return (
    <div className="space-y-12">
      <Header data={data} />
      <HealthPanel data={data} />
      <WorldSection data={data} />
      <CastSection entities={data.entities} bookId={data.book.id} />
      <SceneConsistencySection data={data} />
      <CostSection data={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
function Header({ data }: { data: BookDebug }) {
  const { book, world } = data;
  return (
    <header>
      <p className="eyebrow mb-2">INSPECTOR</p>
      <h1 className="font-display text-3xl leading-tight sm:text-4xl">
        {book.title}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-2 font-ui text-xs">
        {book.author ? <Chip>{book.author}</Chip> : null}
        <Chip>book status: {book.status}</Chip>
        <Chip>world: {world?.status ?? "none"}</Chip>
        <Chip>visibility: {book.visibility ?? "—"}</Chip>
        <Chip>archetype: {book.themeArchetype ?? "—"}</Chip>
        <Chip>chunks: {book.totalChunks ?? "—"}</Chip>
        <Chip>image interval: {book.imageInterval ?? "—"}</Chip>
        <Mono className="text-muted-foreground">{book.id}</Mono>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Health panel + anomalies
// ---------------------------------------------------------------------------
function HealthPanel({ data }: { data: BookDebug }) {
  const h = data.health;
  const coverage =
    h.overlayCoverage === null
      ? "—"
      : `${Math.round(h.overlayCoverage * 100)}%`;
  const unresolved =
    h.unresolvedRate === null ? "—" : `${Math.round(h.unresolvedRate * 100)}%`;
  return (
    <Section title="Health" subtitle="Quick signals for pipeline quality.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Overlay coverage"
          value={coverage}
          sub={`${h.overlayCount} / ${h.totalChunks ?? "—"} chunks`}
        />
        <Stat
          label="Images"
          value={String(h.imageCount)}
          sub={
            h.expectedImages !== null
              ? `~${h.expectedImages} expected @ every ${h.imageInterval}`
              : "no interval"
          }
        />
        <Stat
          label="Unresolved rate"
          value={unresolved}
          warn={h.unresolvedRate !== null && h.unresolvedRate > 0.25}
          sub={`${h.totalUnresolvedMentions} unresolved / ${h.totalActiveBindings} bound`}
        />
        <Stat
          label="Cast"
          value={String(h.entityCount)}
          warn={h.entitiesWithoutIntroduction > 0 || h.ghostBindingCount > 0}
          sub={`${h.entitiesWithoutIntroduction} no-intro · ${h.ghostBindingCount} ghost`}
        />
      </div>

      {data.anomalies.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {data.anomalies.map((a, i) => (
            <AnomalyRow key={i} anomaly={a} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 font-ui text-sm text-muted-foreground">
          No anomalies detected.
        </p>
      )}
    </Section>
  );
}

function AnomalyRow({ anomaly }: { anomaly: DebugAnomaly }) {
  const warn = anomaly.level === "warn";
  return (
    <li
      className="flex items-start gap-3 rounded-md border px-3 py-2"
      style={{
        borderColor: warn
          ? "color-mix(in srgb, var(--destructive) 40%, transparent)"
          : "var(--border)",
        background: warn
          ? "color-mix(in srgb, var(--destructive) 8%, transparent)"
          : "var(--card)",
      }}
    >
      <span
        aria-hidden
        className="mt-0.5 text-xs font-medium"
        style={{ color: warn ? "var(--destructive)" : "var(--amber, #b7791f)" }}
      >
        {warn ? "▲" : "●"}
      </span>
      <div>
        <p className="font-ui text-sm font-medium">{anomaly.label}</p>
        <p className="font-ui text-xs text-muted-foreground">
          {anomaly.detail}
        </p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// World reference
// ---------------------------------------------------------------------------
function WorldSection({ data }: { data: BookDebug }) {
  const world = data.world;
  if (!world) {
    return (
      <Section title="World reference">
        <p className="font-ui text-sm text-muted-foreground">
          No world reference row — this book has not been analyzed.
        </p>
      </Section>
    );
  }
  const vs = world.visualStyle;
  return (
    <Section
      title="World reference"
      subtitle={`status: ${world.status ?? "—"}${
        world.updatedAt ? ` · updated ${fmtDate(world.updatedAt)}` : ""
      }`}
    >
      {world.error ? (
        <p className="mb-4 rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 font-ui text-sm text-[var(--destructive)]">
          {world.error}
        </p>
      ) : null}

      <Card title="Setting">
        <p className="font-ui text-sm leading-relaxed">
          {world.settingDescription ?? (
            <span className="text-muted-foreground">—</span>
          )}
        </p>
      </Card>

      <Card title="Visual style" rawValue={vs}>
        {vs ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {Object.entries(vs).map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <dt className="eyebrow">{k}</dt>
                <dd className="font-ui text-sm">{String(v)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </Card>

      <Card title="Model versions" rawValue={world.modelVersions}>
        <KeyValueList value={world.modelVersions} />
      </Card>

      <Card title="Timeline" rawValue={world.timeline}>
        <JsonList value={world.timeline} empty="No timeline entries." />
      </Card>

      <Card title="Commitments" rawValue={world.commitments}>
        <JsonList value={world.commitments} empty="No commitments." />
      </Card>

      <Card title="Unknowns" rawValue={world.unknowns}>
        <JsonList value={world.unknowns} empty="No open unknowns." />
      </Card>
    </Section>
  );
}

function KeyValueList({ value }: { value: unknown }) {
  const rec =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!rec || Object.keys(rec).length === 0) {
    return <p className="text-sm text-muted-foreground">—</p>;
  }
  return (
    <dl className="space-y-1">
      {Object.entries(rec).map(([k, v]) => (
        <div key={k} className="flex flex-wrap gap-2 text-sm">
          <dt className="eyebrow shrink-0">{k}</dt>
          <dd className="font-mono text-xs break-all">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function JsonList({ value, empty }: { value: unknown; empty: string }) {
  if (!Array.isArray(value) || value.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ol className="space-y-2">
      {value.map((item, i) => {
        const rec =
          item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>)
            : null;
        return (
          <li
            key={i}
            className="border-l-2 border-border pl-3 font-ui text-sm leading-relaxed"
          >
            {rec ? (
              <div className="flex flex-wrap items-baseline gap-x-2">
                {Object.entries(rec).map(([k, v]) => (
                  <span key={k}>
                    <span className="eyebrow mr-1">{k}</span>
                    <span>
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              String(item)
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Cast / entities
// ---------------------------------------------------------------------------
function CastSection({
  entities,
  bookId,
}: {
  entities: DebugEntity[];
  bookId: string;
}) {
  return (
    <Section
      title={`Cast — ${entities.length} entities`}
      subtitle="Extraction + alias resolution. Full attributes, no frontier filtering."
    >
      {entities.length === 0 ? (
        <p className="font-ui text-sm text-muted-foreground">
          No entities extracted.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse font-ui text-sm">
            <thead>
              <tr className="text-left">
                {[
                  "Entity",
                  "Kind",
                  "Intro",
                  "Pages",
                  "Aliases",
                  "Attributes",
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
              {entities.map((e) => (
                <EntityRow key={e.id} entity={e} bookId={bookId} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function EntityRow({
  entity,
  bookId,
}: {
  entity: DebugEntity;
  bookId: string;
}) {
  const [open, setOpen] = useState(false);
  const attrs = entity.attributes;
  const hasAttrs = attrs && Object.keys(attrs).length > 0;
  return (
    <>
      <tr className="border-b border-border align-top transition-colors last:border-b-0 hover:bg-[var(--muted)]/40">
        <td className="px-3 py-2">
          <div className="font-ui font-medium">
            {entity.kind === "character" ? (
              <Link
                href={`/books/${bookId}/characters/${entity.id}`}
                className="underline decoration-dotted underline-offset-2 hover:text-[var(--world-accent)]"
              >
                {entity.name}
              </Link>
            ) : (
              entity.name
            )}
          </div>
          <Mono className="text-muted-foreground">{entity.id}</Mono>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">{entity.kind}</td>
        <td className="px-3 py-2 tabular-nums">
          {entity.flags.noIntroduction ? (
            <Warn title="No introducedAtChunk — never frontier-gated">—</Warn>
          ) : (
            entity.introducedAtChunk
          )}
        </td>
        <td
          className="px-3 py-2 tabular-nums"
          title={
            entity.activeChunks.length
              ? `Active on chunks: ${entity.activeChunks.join(", ")}`
              : "Never appears in an overlay"
          }
        >
          {entity.activePageCount}
        </td>
        <td className="px-3 py-2">
          {entity.aliases.length === 0 ? (
            <Warn title="No aliases resolved">none</Warn>
          ) : (
            <div className="flex flex-wrap gap-1">
              {entity.aliases.map((a) => (
                <span
                  key={a}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {a}
                </span>
              ))}
            </div>
          )}
        </td>
        <td className="max-w-[280px] px-3 py-2">
          {hasAttrs ? (
            <dl className="space-y-0.5">
              {Object.entries(attrs).map(([k, v]) => (
                <div key={k}>
                  <span className="eyebrow mr-1">{k}</span>
                  <span className="text-sm">{String(v)}</span>
                </div>
              ))}
            </dl>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {entity.visualDescription ? (
            <p className="mt-1 text-xs text-muted-foreground italic">
              visual: {entity.visualDescription}
            </p>
          ) : null}
        </td>
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {open ? "hide" : "raw"}
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-border">
          <td colSpan={7} className="px-3 py-2">
            <Pre value={entity} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Scene consistency / overlay ↔ entity binding
// ---------------------------------------------------------------------------
function SceneConsistencySection({ data }: { data: BookDebug }) {
  const { overlays, entities } = data;
  const [onlyIssues, setOnlyIssues] = useState(false);

  const visible = onlyIssues
    ? overlays.filter(
        (o) =>
          o.unresolvedMentions.length > 0 ||
          o.activeEntities.some((e) => e.ghost),
      )
    : overlays;

  // Co-occurrence summary: entities sorted by how many pages they're active on.
  const cooccur = [...entities]
    .filter((e) => e.activePageCount > 0)
    .sort((a, b) => b.activePageCount - a.activePageCount);

  return (
    <Section
      title="Scene consistency — overlay ↔ entity binding"
      subtitle="How each page's overlay binds to the cast. Unresolved mentions and ghost bindings are the key quality signal."
    >
      <div className="mb-6">
        <h3 className="eyebrow mb-2">Entity co-occurrence</h3>
        {cooccur.length === 0 ? (
          <p className="font-ui text-sm text-muted-foreground">
            No entities are bound to any overlay yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {cooccur.map((e) => (
              <span
                key={e.id}
                title={`chunks: ${e.activeChunks.join(", ")}`}
                className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-ui text-xs"
              >
                <span className="font-medium">{e.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {e.activePageCount}p
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h3 className="eyebrow">Per-page overlays ({overlays.length})</h3>
        <label className="flex items-center gap-2 font-ui text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyIssues}
            onChange={(e) => setOnlyIssues(e.target.checked)}
          />
          Only pages with binding issues
        </label>
      </div>

      {overlays.length === 0 ? (
        <p className="font-ui text-sm text-muted-foreground">
          No overlays generated yet — they are produced on demand as readers
          advance.
        </p>
      ) : visible.length === 0 ? (
        <p className="font-ui text-sm text-muted-foreground">
          No pages with binding issues. 🎉
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((o) => (
            <OverlayCard key={o.chunkIdx} overlay={o} bookId={data.book.id} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function OverlayCard({
  overlay,
  bookId,
}: {
  overlay: DebugOverlay;
  bookId: string;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const hasIssue =
    overlay.unresolvedMentions.length > 0 ||
    overlay.activeEntities.some((e) => e.ghost);
  return (
    <li
      className="rounded-lg border p-4"
      style={{
        borderColor: hasIssue
          ? "color-mix(in srgb, var(--destructive) 35%, transparent)"
          : "var(--border)",
        background: "var(--card)",
      }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          chunk {overlay.chunkIdx}
        </span>
        <StatusDot status={overlay.status} />
        {overlay.mood ? (
          <span className="font-ui text-xs text-muted-foreground italic">
            {overlay.mood}
          </span>
        ) : null}
        {overlay.image ? (
          <span
            className="rounded-full px-2 py-0.5 font-ui text-[11px]"
            style={{
              background: "var(--world-accent)",
              color: "var(--world-accent-fg)",
            }}
          >
            image · {overlay.image.model ?? "?"}
          </span>
        ) : (
          <span className="font-ui text-[11px] text-muted-foreground">
            no image
          </span>
        )}
        <button
          type="button"
          onClick={() => setRawOpen((o) => !o)}
          className="ml-auto rounded-full border border-border px-2 py-0.5 font-ui text-[11px] text-muted-foreground hover:text-foreground"
        >
          {rawOpen ? "hide raw" : "raw"}
        </button>
      </div>

      <p className="font-ui text-sm leading-relaxed">
        {overlay.sceneDescription ?? (
          <span className="text-muted-foreground">no scene description</span>
        )}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="eyebrow mb-1">
            Active entities ({overlay.activeEntities.length})
          </p>
          {overlay.activeEntities.length === 0 ? (
            <p className="font-ui text-xs text-muted-foreground">none bound</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {overlay.activeEntities.map((e) =>
                e.ghost ? (
                  <span
                    key={e.id}
                    title="Bound id not present in cast (ghost binding)"
                    className="rounded px-1.5 py-0.5 font-mono text-[11px]"
                    style={{
                      background:
                        "color-mix(in srgb, var(--destructive) 16%, transparent)",
                      color: "var(--destructive)",
                    }}
                  >
                    {e.id} ⚠
                  </span>
                ) : e.id.startsWith("char:") ? (
                  <Link
                    key={e.id}
                    href={`/books/${bookId}/characters/${e.id}`}
                    className="rounded bg-muted px-1.5 py-0.5 font-ui text-[11px] underline decoration-dotted underline-offset-2 hover:text-[var(--world-accent)]"
                  >
                    {e.name}
                  </Link>
                ) : (
                  <span
                    key={e.id}
                    className="rounded bg-muted px-1.5 py-0.5 font-ui text-[11px]"
                  >
                    {e.name}
                  </span>
                ),
              )}
            </div>
          )}
        </div>

        <div>
          <p className="eyebrow mb-1">
            Unresolved mentions ({overlay.unresolvedMentions.length})
          </p>
          {overlay.unresolvedMentions.length === 0 ? (
            <p className="font-ui text-xs text-muted-foreground">none</p>
          ) : (
            <ul className="space-y-0.5">
              {overlay.unresolvedMentions.map((u, i) => (
                <li key={i} className="font-ui text-xs">
                  <span
                    className="font-mono"
                    style={{ color: "var(--destructive)" }}
                  >
                    {u.name}
                  </span>
                  {u.reason ? (
                    <span className="text-muted-foreground"> — {u.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {overlay.interpretiveNotes ? (
        <p className="mt-3 border-l-2 border-border pl-3 font-ui text-xs text-muted-foreground italic">
          {overlay.interpretiveNotes}
        </p>
      ) : null}

      {overlay.image?.prompt ? (
        <details className="mt-2">
          <summary className="cursor-pointer font-ui text-[11px] text-muted-foreground">
            image prompt
          </summary>
          <p className="mt-1 font-mono text-[11px] leading-relaxed break-words">
            {overlay.image.prompt}
          </p>
        </details>
      ) : null}

      {rawOpen ? <Pre value={overlay.raw} className="mt-3" /> : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Cost & generation
// ---------------------------------------------------------------------------
function CostSection({ data }: { data: BookDebug }) {
  const { usage, jobs } = data;
  return (
    <Section
      title="Cost & generation"
      subtitle={`${usage.totals.events} usage events · ${usage.totals.tokens.toLocaleString()} tokens · $${usage.totals.costUsd.toFixed(4)}`}
    >
      {usage.groups.length === 0 ? (
        <p className="font-ui text-sm text-muted-foreground">
          No usage events recorded for this book.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse font-ui text-sm">
            <thead>
              <tr className="text-left">
                {["Operation", "Model", "Events", "In", "Out", "Cost"].map(
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
              {usage.groups.map((g, i) => (
                <tr
                  key={i}
                  className="border-b border-border last:border-b-0 hover:bg-[var(--muted)]/40"
                >
                  <td className="px-3 py-2">{g.operation ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Mono className="text-muted-foreground">
                      {g.provider ? `${g.provider}:` : ""}
                      {g.model ?? "—"}
                    </Mono>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{g.events}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {g.inputTokens.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {g.outputTokens.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    ${g.costUsd.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="eyebrow mt-6 mb-2">Job history</h3>
      {jobs.length === 0 ? (
        <p className="font-ui text-sm text-muted-foreground">No jobs.</p>
      ) : (
        <ul className="space-y-1">
          {jobs.map((j) => (
            <li
              key={j.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1.5 font-ui text-xs"
            >
              <StatusDot status={j.status} />
              <span className="font-medium">{j.kind}</span>
              <span className="text-muted-foreground">{j.status}</span>
              {j.stage ? (
                <span className="text-muted-foreground">· {j.stage}</span>
              ) : null}
              {j.progress != null ? (
                <span className="text-muted-foreground tabular-nums">
                  · {j.progress}%
                </span>
              ) : null}
              <span className="ml-auto text-muted-foreground">
                {fmtDate(j.createdAt)}
              </span>
              {j.error ? (
                <span
                  className="w-full font-mono"
                  style={{ color: "var(--destructive)" }}
                >
                  {j.error}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------
function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 border-b border-border pb-2">
        <h2 className="font-display text-xl">{title}</h2>
        {subtitle ? (
          <p className="font-ui text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Card({
  title,
  rawValue,
  children,
}: {
  title: string;
  rawValue?: unknown;
  children: React.ReactNode;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  return (
    <div className="mb-3 rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="eyebrow">{title}</h3>
        {rawValue !== undefined ? (
          <button
            type="button"
            onClick={() => setRawOpen((o) => !o)}
            className="rounded-full border border-border px-2 py-0.5 font-ui text-[11px] text-muted-foreground hover:text-foreground"
          >
            {rawOpen ? "hide JSON" : "raw JSON"}
          </button>
        ) : null}
      </div>
      {rawOpen ? <Pre value={rawValue} /> : children}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="eyebrow mb-1">{label}</p>
      <p
        className="font-display text-2xl"
        style={warn ? { color: "var(--destructive)" } : undefined}
      >
        {value}
      </p>
      {sub ? (
        <p className="font-ui text-[11px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
      {children}
    </span>
  );
}

function Mono({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`font-mono text-[11px] break-all ${className}`}>
      {children}
    </span>
  );
}

function Warn({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="rounded px-1 py-0.5 text-xs"
      style={{
        background: "color-mix(in srgb, var(--destructive) 14%, transparent)",
        color: "var(--destructive)",
      }}
    >
      {children}
    </span>
  );
}

function StatusDot({ status }: { status: string | null }) {
  const ok = status === "ready" || status === "completed" || status === "done";
  const bad = status === "failed" || status === "error";
  const color = bad
    ? "var(--destructive)"
    : ok
      ? "var(--world-accent)"
      : "var(--muted-foreground)";
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      <span className="sr-only">{status ?? "unknown"}</span>
    </span>
  );
}

function Pre({
  value,
  className = "",
}: {
  value: unknown;
  className?: string;
}) {
  return (
    <pre
      className={`overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed ${className}`}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
