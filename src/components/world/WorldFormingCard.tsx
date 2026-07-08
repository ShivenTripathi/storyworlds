"use client";

import { useState } from "react";
import type { Job } from "./types";

interface WorldFormingCardProps {
  /** The job currently driving analysis, or null if still being resolved. */
  job: Job | null;
  /** Re-triggers analysis after a failure. */
  onRetry: () => void | Promise<void>;
  /** Tighter spacing/type for the reader's WorldRail. */
  compact?: boolean;
  className?: string;
}

/**
 * The diegetic analysis-in-progress module: a pulsing ink glyph, the
 * current pipeline stage, and a thin progress filament. Doubles as the
 * failure state (oxblood accent + retry).
 */
export function WorldFormingCard({
  job,
  onRetry,
  compact = false,
  className = "",
}: WorldFormingCardProps) {
  const [retrying, setRetrying] = useState(false);
  const failed = job?.status === "failed";
  const progress = Math.max(0, Math.min(100, job?.progress ?? 0));

  async function handleRetry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      className={`rounded-lg border ${compact ? "p-4" : "p-6"} ${className}`}
      style={{
        borderColor: failed ? "var(--destructive)" : "var(--world-frame)",
        background: "var(--world-surface)",
      }}
    >
      {failed ? (
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
            style={{ background: "var(--destructive)" }}
          />
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-1">THE WORLD RESISTS</p>
            <p
              className={`font-display italic ${compact ? "text-sm" : "text-base"}`}
              style={{ color: "var(--destructive)" }}
            >
              {job?.error || "Something interrupted the telling."}
            </p>
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={retrying}
              className="font-ui mt-3 rounded-full border px-4 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{ borderColor: "var(--destructive)", color: "var(--destructive)" }}
            >
              {retrying ? "Trying again…" : "Try again"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-4">
          <QuillGlyph />
          <div className="min-w-0 flex-1">
            <p
              className={`font-display italic leading-snug ${compact ? "text-sm" : "text-base"}`}
              style={{ color: "var(--world-accent)" }}
            >
              {job?.stage || "The world is stirring…"}
              {job?.progress != null ? (
                <span className="font-ui ml-1.5 text-xs not-italic opacity-70">
                  {Math.round(progress)}%
                </span>
              ) : null}
            </p>

            <div
              className="mt-3 h-[3px] w-full overflow-hidden rounded-full"
              style={{ background: "var(--world-frame)" }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
            >
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%`, background: "var(--world-accent)" }}
              />
            </div>

            {!compact ? (
              <p className="font-ui mt-3 text-xs text-muted-foreground italic">
                You can keep reading — the world forms alongside you.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** A small pulsing ink glyph — pure CSS, respects prefers-reduced-motion. */
function QuillGlyph() {
  return (
    <span
      aria-hidden="true"
      className="relative mt-1 flex h-3 w-3 shrink-0 items-center justify-center"
    >
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none"
        style={{ background: "var(--world-accent)" }}
      />
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ background: "var(--world-accent)" }}
      />
    </span>
  );
}
