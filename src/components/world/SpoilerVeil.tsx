"use client";

import { useState } from "react";

interface SpoilerVeilProps {
  label?: string;
  children: React.ReactNode;
}

/**
 * Blurs its children behind a lock chip until the reader taps to reveal —
 * once revealed, stays revealed for the session (in-memory only; a refresh
 * re-veils it). Revealing is a single, deliberate click/tap (Enter/Space
 * activate the button normally) — the blur plus the one-line warning that
 * this is ahead of the reader's progress is already the deliberate step;
 * a hold added friction without adding safety.
 */
export function SpoilerVeil({ label, children }: SpoilerVeilProps) {
  const [revealed, setRevealed] = useState(false);

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
          onClick={() => setRevealed(true)}
          aria-describedby="spoiler-veil-hint"
          className="flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 py-2 font-ui text-xs transition-colors select-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          style={{
            borderColor: "var(--world-frame)",
            background: "var(--spoiler-veil, var(--muted))",
          }}
        >
          <LockGlyph />
          <span>{label ?? "Reveal spoiler"}</span>
        </button>
        <span id="spoiler-veil-hint" className="sr-only">
          This is ahead of where you&rsquo;ve read. Tap to reveal it anyway.
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
