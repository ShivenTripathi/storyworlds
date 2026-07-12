"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { AppearanceTimeline } from "@/components/dossier/AppearanceTimeline";
import { FactRow, SectionLabel } from "@/components/dossier/parts";
import { PortraitPlate } from "@/components/dossier/PortraitPlate";
import { RelationshipChips } from "@/components/dossier/RelationshipChips";
import { fetchDossier } from "@/components/world/api";
import { ProgressChip } from "@/components/world/ProgressChip";
import type { DossierData } from "@/components/world/types";
import { assembleBio } from "@/domain/bio";

type LoadState = "loading" | "ready" | "not-found" | "error";

export default function CharacterDossierPage({
  params,
}: {
  params: Promise<{ bookId: string; entityId: string }>;
}) {
  const { bookId, entityId } = use(params);
  // On client-side <Link> navigation Next hands back the raw path segment,
  // so an id like `char:sherlock-holmes` arrives percent-encoded
  // (`char%3Asherlock-holmes`). Decode before it's used as an entity id.
  const decodedEntityId = decodeURIComponent(entityId);

  const [dossier, setDossier] = useState<DossierData | null>(null);
  const [themeArchetype, setThemeArchetype] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { dossier: d, themeArchetype: theme } = await fetchDossier(
          bookId,
          decodedEntityId,
        );
        if (cancelled) return;
        setDossier(d);
        setThemeArchetype(theme);
        setLoadState(d ? "ready" : "not-found");
      } catch {
        if (!cancelled) setLoadState("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId, decodedEntityId]);

  if (loadState === "loading") {
    return (
      <div className="py-24 text-center">
        <p className="font-ui text-sm text-muted-foreground">
          Opening the dossier…
        </p>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="py-24 text-center">
        <p className="font-ui text-sm text-[var(--destructive)]">
          Couldn&apos;t reach the world. Try refreshing.
        </p>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div
        data-world-theme={themeArchetype ?? undefined}
        className="py-24 text-center"
      >
        <p className="eyebrow mb-4">NOT YET DISCOVERED</p>
        <h1 className="font-display text-2xl">
          You haven&apos;t discovered this yet.
        </h1>
        <Link
          href={`/books/${bookId}/read`}
          className="mt-6 inline-block font-ui text-sm text-[var(--primary)] hover:opacity-80"
        >
          Back to reading
        </Link>
      </div>
    );
  }

  const { entity, visual, appearances, relationships, innerLifeGated } =
    dossier;
  const attributes = entity.attributes;

  return (
    <div
      data-world-theme={themeArchetype ?? undefined}
      className="mx-auto max-w-5xl px-6 py-12"
    >
      <Link
        href={`/books/${bookId}/read`}
        className="font-ui text-xs text-muted-foreground transition-colors hover:text-[var(--world-accent)]"
      >
        ← Back to reading
      </Link>

      <header className="mt-6">
        <p className="eyebrow mb-2">DOSSIER · AS OF YOUR PAGE</p>
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">
          {entity.name}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ProgressChip introducedAtChunk={entity.introducedAtChunk} />
          {appearances.pageCount > 0 ? (
            <ProgressChip
              label={`SEEN ON ${appearances.pageCount} ${
                appearances.pageCount === 1 ? "PAGE" : "PAGES"
              }`}
            />
          ) : null}
        </div>
      </header>

      <div className="mt-10 grid items-start gap-10 md:grid-cols-[300px_1fr]">
        {/* ── Visual + ledger ─────────────────────────────────────────── */}
        <aside className="space-y-8">
          <div className="mx-auto w-full max-w-[220px] md:max-w-none">
            <PortraitPlate visual={visual} name={entity.name} />
          </div>

          {entity.visualDescription ? (
            <section>
              <SectionLabel>IN THE MIND&apos;S EYE</SectionLabel>
              <p className="font-reading text-sm leading-relaxed text-foreground italic">
                {entity.visualDescription}
              </p>
            </section>
          ) : null}

          <section>
            <SectionLabel>THE RECORD</SectionLabel>
            <div>
              <FactRow
                label="KIND"
                value={
                  <span className="capitalize">{entity.kind ?? "figure"}</span>
                }
              />
              {entity.introducedAtChunk != null ? (
                <FactRow
                  label="FIRST APPEARS"
                  value={`Page ${entity.introducedAtChunk + 1}`}
                />
              ) : null}
              <FactRow
                label="SEEN ON"
                value={
                  appearances.pageCount > 0
                    ? `${appearances.pageCount} ${
                        appearances.pageCount === 1 ? "page" : "pages"
                      }`
                    : "—"
                }
              />
              {appearances.firstPage != null && appearances.lastPage != null ? (
                <FactRow
                  label="SPAN"
                  value={
                    appearances.firstPage === appearances.lastPage
                      ? `Page ${appearances.firstPage}`
                      : `Pages ${appearances.firstPage}–${appearances.lastPage}`
                  }
                />
              ) : null}
            </div>
          </section>
        </aside>

        {/* ── Prose, appearances, relationships ───────────────────────── */}
        <main className="space-y-10">
          {(() => {
            // A flowing bio, not disconnected attribute fragments: the fuller
            // introduction (attributes.description) leads, with the short
            // role tag folded in as a closing line. Neither field is
            // frontier-gated — they describe the entity as introduced, never
            // their arc's end (see WorldEntityAttributesSchema).
            const bio = assembleBio([
              attributes?.description,
              attributes?.role,
            ]);
            return bio ? (
              <section>
                <SectionLabel>WHO THEY ARE</SectionLabel>
                <p className="font-reading text-base leading-relaxed">{bio}</p>
              </section>
            ) : null;
          })()}

          <InnerLifeSection
            attributes={attributes}
            gated={innerLifeGated}
            name={entity.name}
          />

          {appearances.pageCount > 0 ? (
            <section>
              <SectionLabel>APPEARANCES</SectionLabel>
              <p className="font-reading text-sm leading-relaxed text-muted-foreground">
                Present on{" "}
                <span className="text-foreground">
                  {appearances.pageCount}{" "}
                  {appearances.pageCount === 1 ? "page" : "pages"}
                </span>{" "}
                of what you&apos;ve read
                {appearances.firstPage != null
                  ? `, first on page ${appearances.firstPage}`
                  : ""}
                .
              </p>
              <div className="mt-4">
                <AppearanceTimeline appearances={appearances} />
              </div>
            </section>
          ) : null}

          <section>
            <SectionLabel>SEEN ALONGSIDE</SectionLabel>
            {relationships.length > 0 ? (
              <RelationshipChips
                bookId={bookId}
                relationships={relationships}
              />
            ) : (
              <p className="font-reading text-sm leading-relaxed text-muted-foreground italic">
                No shared scenes yet — companions will surface here as you read
                on.
              </p>
            )}
          </section>
        </main>
      </div>

      {/* ── Conversation ─────────────────────────────────────────────── */}
      {!chatOpen ? (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="mt-12 rounded-full bg-[var(--world-accent)] px-6 py-2.5 font-ui text-sm font-medium text-[var(--world-accent-fg)] transition-opacity hover:opacity-90"
        >
          Talk to {entity.name}
        </button>
      ) : (
        <section
          className="mt-12 border-t pt-8"
          style={{ borderColor: "var(--world-frame)" }}
        >
          <p className="eyebrow mb-4">A CONVERSATION</p>
          <div
            className="h-[75dvh] max-h-[560px] min-h-[420px] rounded-md border p-4"
            style={{
              borderColor: "var(--world-frame)",
              background: "var(--world-surface)",
            }}
          >
            <ChatPanel
              bookId={bookId}
              entityId={entity.id}
              entityName={entity.name}
              chunkIdx={entity.introducedAtChunk ?? 0}
            />
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * The inner life: a flowing paragraph once the reader has earned it, or a
 * sealed affordance (never the content itself) while the frontier still hides
 * it. Renders nothing when the character simply has no inner-life data.
 */
function InnerLifeSection({
  attributes,
  gated,
  name,
}: {
  attributes: DossierData["entity"]["attributes"];
  gated: boolean;
  name: string;
}) {
  // Revealed inner-life fragments read as one flowing paragraph rather than
  // a bulleted ledger — still exactly the same fields, in the same order,
  // that reduceAttributes (src/services/world.ts) already stripped out
  // whenever the frontier hasn't earned them yet. `gated` and the content
  // here always agree: reduceAttributes deletes these keys server-side
  // until earned, so `bio` is only ever non-null when it's safe to show.
  const bio = assembleBio([
    attributes?.internalState,
    attributes?.keyMotivation,
    attributes?.scars,
  ]);

  if (!bio && !gated) return null;

  return (
    <section>
      <SectionLabel>THE INNER LIFE</SectionLabel>
      {gated ? (
        <div
          className="rounded-md border border-dashed px-4 py-5"
          style={{
            borderColor: "var(--world-frame)",
            background:
              "color-mix(in srgb, var(--world-accent) 5%, transparent)",
          }}
        >
          <p
            aria-hidden="true"
            className="mb-2 font-display text-lg"
            style={{ color: "var(--world-accent)" }}
          >
            ❧
          </p>
          <p className="font-reading text-sm leading-relaxed text-muted-foreground italic">
            {name}&apos;s inner life stays sealed for now. Keep reading — their
            motivations and scars unseal once you&apos;ve spent more time
            together.
          </p>
        </div>
      ) : (
        <p className="font-reading text-sm leading-relaxed">{bio}</p>
      )}
    </section>
  );
}
