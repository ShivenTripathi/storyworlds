import type { DossierAppearances } from "@/components/world/types";

interface AppearanceTimelineProps {
  appearances: DossierAppearances;
}

/**
 * A quiet engraved tick-strip showing where — across the pages read so far —
 * the character is present. The strip's right edge is the reader's frontier
 * (never the whole book), so it never hints at appearances the reader hasn't
 * reached. Each tick is one page they're active on.
 */
export function AppearanceTimeline({ appearances }: AppearanceTimelineProps) {
  const { ticks, frontierChunk, totalChunks } = appearances;
  if (ticks.length === 0) return null;

  const lastTick = ticks[ticks.length - 1];
  // Extent = how far the reader has read (frontier), falling back to book
  // length, then to the last appearance — always ≥ the last tick so nothing
  // clips off the right edge.
  const extent = Math.max(
    1,
    frontierChunk ?? totalChunks ?? lastTick,
    lastTick,
  );

  const rightLabel =
    frontierChunk != null
      ? `Your page ${frontierChunk + 1}`
      : totalChunks != null
        ? `Page ${totalChunks}`
        : `Page ${lastTick + 1}`;

  return (
    <div>
      <div
        className="relative h-9 overflow-hidden rounded-sm border"
        style={{
          borderColor: "var(--world-frame)",
          background: "color-mix(in srgb, var(--world-accent) 6%, transparent)",
        }}
      >
        {ticks.map((t, i) => (
          <span
            key={`${t}-${i}`}
            aria-hidden="true"
            className="absolute top-1.5 bottom-1.5 w-[2px] -translate-x-1/2 rounded-full"
            style={{
              left: `${Math.min(100, (t / extent) * 100)}%`,
              background: "var(--world-accent)",
              opacity: 0.75,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-ui text-[10px] tracking-wide text-muted-foreground uppercase">
        <span>Page 1</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}
