"use client";

import { useState } from "react";
import { usePressAndHold } from "@/components/chat/usePressAndHold";

interface SpoilerVeilProps {
  label?: string;
  children: React.ReactNode;
}

/**
 * Blurs its children behind a lock chip until the reader presses and
 * holds to reveal — once revealed, stays revealed for the session
 * (in-memory only; a refresh re-veils it).
 */
export function SpoilerVeil({ label, children }: SpoilerVeilProps) {
  const [revealed, setRevealed] = useState(false);
  const { progress, pressing, handlers } = usePressAndHold(
    () => setRevealed(true),
    600,
  );

  if (revealed) return <>{children}</>;

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none blur-sm select-none"
      >
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <button
          type="button"
          {...handlers}
          aria-describedby="spoiler-veil-hint"
          className="relative flex items-center gap-1.5 overflow-hidden rounded-full border px-3 py-1.5 font-ui text-xs select-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          style={{
            borderColor: "var(--world-frame)",
            background: "var(--spoiler-veil, var(--muted))",
          }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0"
            style={{
              width: `${progress * 100}%`,
              background: "var(--world-accent)",
              opacity: 0.35,
              transition: pressing ? "none" : "width 150ms ease",
            }}
          />
          <LockGlyph />
          <span className="relative z-10">
            {label ?? "Unlocks as you read"}
          </span>
        </button>
        <span id="spoiler-veil-hint" className="sr-only">
          Press and hold, or hold Space or Enter, to reveal this spoiler.
        </span>
      </div>
    </div>
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
      className="relative z-10 shrink-0"
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
