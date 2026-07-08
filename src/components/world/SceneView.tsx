"use client";

import { useEffect, useState } from "react";
import { useOverlay, type OverlayState } from "@/components/reader/useOverlay";

interface SceneViewProps {
  bookId: string;
  chunkIdx: number;
  /**
   * When provided (Reader already fetched this page's overlay for the
   * inline ChapterPlate), SceneView skips its own fetch entirely and just
   * renders this state — avoids two components hitting the endpoint for
   * the same page.
   */
  preloaded?: OverlayState;
  /**
   * Activates the "ask the characters" affordance: called with the
   * question text when a suggested question is clicked. When omitted, the
   * rows render in their inert, disabled style (e.g. the book detail page,
   * which has no rail to switch tabs in).
   */
  onAskQuestion?: (question: string) => void;
}

/**
 * The rail's "Scene" tab: illustration + scene description + active cast
 * + (eventually) character chat hooks for the page currently on screen.
 */
export function SceneView({ bookId, chunkIdx, preloaded, onAskQuestion }: SceneViewProps) {
  const ownOverlay = useOverlay(bookId, chunkIdx, { enabled: !preloaded });
  const state = preloaded ?? ownOverlay.state;
  const retry = preloaded ? undefined : ownOverlay.retry;
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    // Deliberate reset of a UI-only state when the page changes, not a
    // derivation of props/state already in React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLightboxOpen(false);
  }, [chunkIdx]);

  if (state.status === "idle" || state.status === "unavailable") return null;

  if (state.status === "loading") {
    return <SceneShimmer label="Reading this page…" />;
  }

  if (state.status === "pending") {
    const label =
      state.attempt >= 2 ? "The world is sketching this page…" : "Reading this page…";
    return <SceneShimmer label={label} />;
  }

  if (state.status === "error") {
    return (
      <div className="space-y-2">
        <p className="font-ui text-sm text-muted-foreground italic">
          The scene wouldn&apos;t come into focus.
        </p>
        {retry ? (
          <button
            type="button"
            onClick={retry}
            className="font-ui text-xs font-medium underline decoration-dotted underline-offset-2"
            style={{ color: "var(--world-accent)" }}
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  const { overlay } = state;

  return (
    <div className="space-y-5">
      {overlay.imageUrl ? (
        <figure>
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            aria-label="View illustration larger"
            className="block w-full overflow-hidden rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            style={{ border: "1px solid var(--world-frame)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- dynamic overlay images */}
            <img
              src={overlay.imageUrl}
              alt={overlay.sceneDescription}
              className="aspect-[4/3] w-full object-cover"
            />
          </button>
          {overlay.imageIsForwardFill ? (
            <figcaption className="eyebrow mt-1.5">FROM AN EARLIER SCENE</figcaption>
          ) : null}
        </figure>
      ) : null}

      <p className="font-reading text-sm leading-relaxed">{overlay.sceneDescription}</p>

      {overlay.activeEntities.length > 0 ? (
        <section>
          <p className="eyebrow mb-2">ON THIS PAGE</p>
          <ul className="flex flex-wrap gap-1.5">
            {overlay.activeEntities.map((entity) => (
              <li
                key={entity.id}
                className="font-ui flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
                style={{ borderColor: "var(--world-frame)" }}
              >
                <KindGlyph kind={entity.kind} />
                {entity.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {overlay.interpretiveNotes ? (
        <section>
          <p className="eyebrow mb-1.5">A CLOSER LOOK</p>
          <p className="font-reading text-sm text-muted-foreground italic leading-relaxed">
            {overlay.interpretiveNotes}
          </p>
        </section>
      ) : null}

      {overlay.suggestedQuestions.length > 0 ? (
        <section>
          <p className="eyebrow mb-1.5">ASK THE CHARACTERS</p>
          <ul className="space-y-1.5">
            {overlay.suggestedQuestions.map((q, i) =>
              onAskQuestion ? (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onAskQuestion(q)}
                    className="font-ui flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    style={{ borderColor: "var(--world-frame)" }}
                  >
                    <ChatGlyph />
                    <span className="min-w-0 flex-1">{q}</span>
                  </button>
                </li>
              ) : (
                <li
                  key={i}
                  title="Open the Chat tab to ask this"
                  className="font-ui flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs text-muted-foreground opacity-70"
                  style={{ borderColor: "var(--world-frame)" }}
                >
                  <ChatGlyph />
                  <span className="min-w-0 flex-1">{q}</span>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      {lightboxOpen && overlay.imageUrl ? (
        <Lightbox src={overlay.imageUrl} alt={overlay.sceneDescription} onClose={() => setLightboxOpen(false)} />
      ) : null}
    </div>
  );
}

function SceneShimmer({ label }: { label: string }) {
  return (
    <div className="space-y-3">
      <div
        className="aspect-[4/3] w-full animate-pulse rounded-sm"
        style={{ background: "var(--muted)" }}
        aria-hidden="true"
      />
      <p className="eyebrow">{label}</p>
      <div className="animate-pulse space-y-2" aria-hidden="true">
        <div className="h-3 w-full rounded" style={{ background: "var(--muted)" }} />
        <div className="h-3 w-4/5 rounded" style={{ background: "var(--muted)" }} />
      </div>
    </div>
  );
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Illustration, larger view"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- dynamic overlay images */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-sm object-contain"
      />
    </div>
  );
}

function KindGlyph({ kind }: { kind: string }) {
  const k = kind.toLowerCase();
  if (k.startsWith("char") || k.startsWith("person")) {
    return (
      <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 opacity-60">
        <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3 13c0-2.5 2.2-4 5-4s5 1.5 5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (k.startsWith("place") || k.startsWith("location")) {
    return (
      <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 opacity-60">
        <path
          d="M8 14s5-4.2 5-8a5 5 0 1 0-10 0c0 3.8 5 8 5 8Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <circle cx="8" cy="6" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  return null;
}

function ChatGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M2.5 3.5h11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H6.5L3.5 13.5V11h-1a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
