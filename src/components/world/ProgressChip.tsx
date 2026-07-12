interface ProgressChipProps {
  introducedAtChunk?: number;
  label?: string;
}

/**
 * Tiny brass-plaque chip noting where an entity first appears — omits
 * itself entirely when the introduction point isn't known.
 */
export function ProgressChip({ introducedAtChunk, label }: ProgressChipProps) {
  if (label == null && introducedAtChunk == null) return null;

  const text = label ?? `FIRST APPEARS · PAGE ${(introducedAtChunk ?? 0) + 1}`;

  return (
    <span
      className="eyebrow inline-flex shrink-0 items-center self-start rounded-full border px-2 py-0.5 whitespace-nowrap"
      style={{ borderColor: "var(--world-frame)" }}
    >
      {text}
    </span>
  );
}
