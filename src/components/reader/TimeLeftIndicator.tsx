"use client";

import { useMemo } from "react";
import { estimateTimeLeft, formatMinutes } from "@/domain/reading-pace";
import type { TocChapter } from "./types";

interface TimeLeftIndicatorProps {
  currentChunk: number;
  totalChunks: number | null;
  /** null while the reader's one-time /toc fetch is still in flight (or it
   * failed) — the indicator renders nothing rather than a misleading guess. */
  chapters: TocChapter[] | null;
  wordCounts: number[] | null;
  className?: string;
}

/**
 * Unobtrusive "time left" readout — words remaining to the next chapter and
 * to the end of the book, divided by a standard reading-speed estimate. Pure
 * client math over data the reader already has (see src/domain/reading-pace.ts);
 * no measurement, no new persisted data.
 */
export function TimeLeftIndicator({
  currentChunk,
  totalChunks,
  chapters,
  wordCounts,
  className,
}: TimeLeftIndicatorProps) {
  const estimate = useMemo(() => {
    if (!totalChunks || !wordCounts) return null;
    return estimateTimeLeft(
      currentChunk,
      totalChunks,
      wordCounts,
      chapters?.map((c) => c.chunkIdx) ?? [],
    );
  }, [currentChunk, totalChunks, wordCounts, chapters]);

  if (!estimate) return null;

  const parts: string[] = [];
  // Omit the "to next chapter" figure once it'd equal "to the end" anyway
  // (last chapter, or no headings detected) — redundant otherwise.
  if (
    estimate.minutesToNextChapter != null &&
    estimate.minutesToNextChapter !== estimate.minutesToEnd
  ) {
    parts.push(
      `${formatMinutes(estimate.minutesToNextChapter)} left in chapter`,
    );
  }
  parts.push(`${formatMinutes(estimate.minutesToEnd)} left in book`);

  return (
    <p
      className={`font-ui text-xs opacity-60 ${className ?? ""}`}
      aria-live="off"
    >
      {parts.join(" · ")}
    </p>
  );
}
