"use client";

import { useState } from "react";
import type { DossierVisual } from "@/components/world/types";

interface PortraitPlateProps {
  visual: DossierVisual;
  name: string;
}

/** Two- or three-letter monogram from a character's name. */
function monogram(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  return (initials || name.slice(0, 1)).toUpperCase();
}

/**
 * The dossier's visual anchor: a double-engraved frame (mirroring the reader's
 * ChapterPlate) around either the earliest illustrated scene the character
 * appears in, or — when the book has no illustration of them yet — an
 * ornamental monogram plate. Caption is the first sentence of that scene, or a
 * quiet "portrait forthcoming" note for the placeholder.
 */
export function PortraitPlate({ visual, name }: PortraitPlateProps) {
  const [loaded, setLoaded] = useState(false);
  const hasImage = Boolean(visual.imageUrl);

  return (
    <figure className="m-0">
      <div
        className="relative rounded-sm p-[3px]"
        style={{ border: "1px solid var(--world-frame)" }}
      >
        <div
          className="rounded-[1px] p-[3px]"
          style={{ boxShadow: "inset 0 0 0 1px var(--world-frame)" }}
        >
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- dynamic overlay image, not a Next-optimizable asset set
            <img
              src={visual.imageUrl ?? undefined}
              alt={visual.caption ?? `A scene featuring ${name}`}
              onLoad={() => setLoaded(true)}
              className={`aspect-[4/5] w-full rounded-sm object-cover transition-opacity duration-300 motion-reduce:transition-none ${
                loaded ? "opacity-100" : "opacity-0"
              }`}
            />
          ) : (
            <div
              className="grid aspect-[4/5] w-full place-items-center rounded-sm"
              style={{
                background:
                  "linear-gradient(160deg, color-mix(in srgb, var(--world-accent) 20%, var(--world-surface)), var(--world-surface))",
              }}
            >
              <span
                aria-hidden="true"
                className="font-display text-6xl leading-none tracking-wide"
                style={{ color: "var(--world-accent)" }}
              >
                {monogram(name)}
              </span>
            </div>
          )}
        </div>
      </div>

      <figcaption className="mt-3">
        <span
          aria-hidden="true"
          className="mb-2 block h-px w-12"
          style={{ background: "var(--world-accent)" }}
        />
        <p className="font-reading text-xs leading-relaxed text-muted-foreground italic">
          {hasImage
            ? (visual.caption ??
              (visual.page ? `Illustrated on page ${visual.page}.` : ""))
            : "No illustrated scene yet — their likeness is drawn as the story unfolds."}
        </p>
      </figcaption>
    </figure>
  );
}
