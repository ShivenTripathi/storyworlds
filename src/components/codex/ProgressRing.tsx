interface ProgressRingProps {
  /** 0-100. */
  percent: number;
  size?: number;
  label?: string;
}

/**
 * A small ring gauge for the Codex header's overall completion. Uses
 * `--world-accent`/`--world-frame` so it picks up the book's archetype
 * theme, same as the rest of the world surfaces.
 */
export function ProgressRing({
  percent,
  size = 56,
  label = "Discoveries completion",
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--world-frame)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--world-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center font-ui text-xs font-semibold text-foreground"
      >
        {clamped}%
      </span>
    </div>
  );
}
