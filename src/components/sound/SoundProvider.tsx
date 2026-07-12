"use client";

import { useEffect } from "react";
import { initSound, playCue, type Cue } from "@/lib/sound";

const CUES = new Set<Cue>([
  "tick",
  "press",
  "release",
  "toggleOn",
  "toggleOff",
  "sparkle",
  "bloom",
  "chime",
  "success",
]);

function asCue(value: string | null | undefined): Cue | null {
  return value && CUES.has(value as Cue) ? (value as Cue) : null;
}

/**
 * Mounts once (in the app layout) and wires a single delegated listener for
 * declarative sound cues — a component opts in with `data-sound="press"`
 * (fires on pointer-down) or `data-sound-hover="sparkle"` (fires on
 * pointer-enter), Cuelume-style, so no per-component imports are needed.
 * Renders nothing.
 */
export function SoundProvider() {
  useEffect(() => {
    initSound();

    const onDown = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-sound]");
      const cue = asCue(el?.getAttribute("data-sound"));
      if (cue) playCue(cue);
    };

    const onOver = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-sound-hover]");
      if (!el) return;
      // Don't re-fire when the pointer moves between the element's own children.
      const related = e.relatedTarget as Element | null;
      if (related && el.contains(related)) return;
      const cue = asCue(el.getAttribute("data-sound-hover"));
      if (cue) playCue(cue);
    };

    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerover", onOver);
    };
  }, []);

  return null;
}
