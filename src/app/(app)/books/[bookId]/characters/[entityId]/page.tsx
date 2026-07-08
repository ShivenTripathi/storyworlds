"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { fetchWorld } from "@/components/world/api";
import { ProgressChip } from "@/components/world/ProgressChip";
import type { World, WorldEntity } from "@/components/world/types";

type LoadState = "loading" | "ready" | "not-found" | "error";

export default function CharacterDossierPage({
  params,
}: {
  params: Promise<{ bookId: string; entityId: string }>;
}) {
  const { bookId, entityId } = use(params);

  const [world, setWorld] = useState<World | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { world: w } = await fetchWorld(bookId);
        if (cancelled) return;
        setWorld(w);
        setLoadState("ready");
      } catch {
        if (!cancelled) setLoadState("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (loadState === "loading") {
    return (
      <div className="py-24 text-center">
        <p className="font-ui text-sm text-muted-foreground">Opening the dossier…</p>
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

  const entity = world?.entities?.find((e) => e.id === entityId);

  if (!entity) {
    return (
      <div className="py-24 text-center">
        <p className="eyebrow mb-4">NOT YET MET</p>
        <h1 className="font-display text-2xl">You haven&apos;t met this character yet.</h1>
        <Link
          href={`/books/${bookId}/read`}
          className="font-ui mt-6 inline-block text-sm text-[var(--primary)] hover:opacity-80"
        >
          Back to reading
        </Link>
      </div>
    );
  }

  return (
    <div data-world-theme={world?.themeArchetype ?? undefined} className="mx-auto max-w-2xl px-6 py-12">
      <p className="eyebrow mb-2">DOSSIER · AS OF YOUR PAGE</p>
      <h1 className="font-display text-4xl leading-tight">{entity.name}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {entity.attributes?.role ? (
          <span className="font-ui text-sm text-muted-foreground">{entity.attributes.role}</span>
        ) : null}
        <ProgressChip introducedAtChunk={entity.introducedAtChunk} />
      </div>

      <DossierSections entity={entity} />

      {!chatOpen ? (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="font-ui mt-8 rounded-full bg-[var(--world-accent)] px-6 py-2.5 text-sm font-medium text-[var(--world-accent-fg)] transition-opacity hover:opacity-90"
        >
          Talk to {entity.name}
        </button>
      ) : (
        <section className="mt-10 border-t pt-8" style={{ borderColor: "var(--world-frame)" }}>
          <p className="eyebrow mb-4">A CONVERSATION</p>
          <div
            className="h-[520px] rounded-md border p-4"
            style={{ borderColor: "var(--world-frame)", background: "var(--world-surface)" }}
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

function DossierSections({ entity }: { entity: WorldEntity }) {
  const { attributes } = entity;
  const hasInnerLife = Boolean(attributes?.internalState || attributes?.keyMotivation);

  return (
    <div className="mt-8 space-y-8">
      {attributes?.role ? (
        <section>
          <p className="eyebrow mb-2">WHO THEY ARE</p>
          <p className="font-reading text-sm leading-relaxed">{attributes.role}</p>
        </section>
      ) : null}

      {hasInnerLife ? (
        <section className="space-y-3">
          <p className="eyebrow mb-2">THE INNER LIFE</p>
          {attributes?.internalState ? (
            <p className="font-reading text-sm leading-relaxed">{attributes.internalState}</p>
          ) : null}
          {attributes?.keyMotivation ? (
            <p className="font-reading text-sm leading-relaxed text-muted-foreground">
              {attributes.keyMotivation}
            </p>
          ) : null}
        </section>
      ) : null}

      {entity.visualDescription ? (
        <section>
          <p className="eyebrow mb-2">IN THE MIND&apos;S EYE</p>
          <p className="font-reading text-sm leading-relaxed italic">{entity.visualDescription}</p>
        </section>
      ) : null}
    </div>
  );
}
