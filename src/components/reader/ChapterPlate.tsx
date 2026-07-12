"use client";

import { useState } from "react";
import type { Overlay } from "@/components/world/types";

interface ChapterPlateProps {
  overlay: Overlay;
}

/** First sentence of the scene description, for the caption line under the plate. */
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?=\s|$)/);
  return (match ? match[0] : text).trim();
}

/**
 * The inline "illustrated edition" moment: a full-measure engraved plate
 * rendered above the page text when this chunk has a freshly generated
 * (non-forward-filled) image. Forward-filled images stay in the rail only —
 * they belong to an earlier scene, not this page.
 */
export function ChapterPlate({ overlay }: ChapterPlateProps) {
  const [loaded, setLoaded] = useState(false);

  if (!overlay.imageUrl || overlay.imageIsForwardFill) return null;

  return (
    <figure className="mb-8">
      <div
        className="relative rounded-sm p-[3px]"
        style={{ border: "1px solid var(--world-frame)" }}
      >
        <div
          className="rounded-[1px] p-[3px]"
          style={{ boxShadow: "inset 0 0 0 1px var(--world-frame)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- external/dynamic overlay images, not a Next-optimizable asset set */}
          <img
            src={overlay.imageUrl}
            alt={firstSentence(overlay.sceneDescription)}
            onLoad={() => setLoaded(true)}
            className={`max-h-[300px] w-full rounded-sm object-cover transition-opacity duration-300 motion-reduce:transition-none sm:max-h-[420px] ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
      </div>
      <figcaption className="mt-3">
        <span
          aria-hidden="true"
          className="mb-2 block h-px w-12"
          style={{ background: "var(--world-accent)" }}
        />
        <p className="font-reading text-sm text-muted-foreground italic">
          {firstSentence(overlay.sceneDescription)}
        </p>
      </figcaption>
    </figure>
  );
}
