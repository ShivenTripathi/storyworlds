"use client";

import { useState } from "react";
import { archetypeForBook } from "./archetypeForBook";

type CoverSize = "sm" | "md" | "lg";

interface TypographicCoverProps {
  bookId: string;
  title: string;
  author?: string | null;
  size?: CoverSize;
  className?: string;
  /** Real analyzed archetype; overrides the hash-based placeholder. */
  archetype?: string | null;
  /** Generated cover illustration URL (src/services/cover.ts). When
   * present, renders the image cover instead of the typographic plate;
   * falls back to typographic whenever absent or if the image fails to
   * load. Optional + backward-compatible — existing callers that don't
   * pass it are unaffected. */
  coverUrl?: string | null;
}

const TITLE_SIZE_CLASSES = {
  short: "text-2xl",
  medium: "text-xl",
  long: "text-base",
} as const;

function titleSizeFor(title: string): keyof typeof TITLE_SIZE_CLASSES {
  if (title.length <= 18) return "short";
  if (title.length <= 40) return "medium";
  return "long";
}

/**
 * A book cover: renders the generated illustration (src/services/cover.ts)
 * when available, framed to match the EX LIBRIS "engraved plate" treatment;
 * falls back to a typographic, illustration-free plate — the title set in
 * Fraunces on a "world" surface — whenever there's no cover yet (pre-
 * analysis, image pipeline off, or a load failure). Used on the shelf grid,
 * the continue-reading hero, and the book detail page. Deterministic
 * per-book archetype (via `data-world-theme`) drives the fallback's palette
 * either way.
 */
export function TypographicCover({
  bookId,
  title,
  author,
  size = "md",
  className = "",
  archetype: archetypeOverride,
  coverUrl,
}: TypographicCoverProps) {
  const archetype = archetypeOverride ?? archetypeForBook(bookId);
  const titleSize = titleSizeFor(title);
  const [imageState, setImageState] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  const showImage = Boolean(coverUrl) && imageState !== "failed";

  return (
    <div
      data-world-theme={archetype}
      className={`relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-[var(--world-frame)] bg-[var(--world-surface)] ${className}`}
    >
      {/* engraved inset ring */}
      <div className="pointer-events-none absolute inset-1 rounded-md border border-[var(--world-frame)] opacity-60" />

      {showImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- storage-
              backed cover URLs (local /api/files/, R2 signed URLs) aren't
              in next/image's static domain allowlist and don't need its
              optimization pipeline for a shelf thumbnail. */}
          <img
            src={coverUrl ?? undefined}
            alt={`Cover illustration for ${title}${author ? ` by ${author}` : ""}`}
            className={`h-full w-full object-cover transition-opacity duration-700 ease-out ${
              imageState === "loaded" ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setImageState("loaded")}
            onError={() => setImageState("failed")}
          />
          {/* subtle vignette so light-toned covers still read cleanly
              against the surrounding shelf chrome */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--ink-950)]/35 via-transparent to-transparent" />
        </>
      ) : (
        <div className="relative flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
          <span
            className="h-px w-10 bg-[var(--world-accent)]"
            aria-hidden="true"
          />
          <p
            className={`line-clamp-4 font-display leading-tight text-[var(--foreground)] ${TITLE_SIZE_CLASSES[titleSize]} ${
              size === "lg" ? "sm:text-3xl" : ""
            }`}
          >
            {title}
          </p>
          {author ? (
            <p className="font-ui text-[11px] tracking-wide text-[var(--muted-foreground)] uppercase">
              {author}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
