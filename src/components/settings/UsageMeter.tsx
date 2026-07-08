interface UsageMeterProps {
  label: string;
  used: number;
  limit: number;
}

/** A thin progress bar showing today's usage against the plan's daily limit. */
export function UsageMeter({ label, used, limit }: UsageMeterProps) {
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-ui text-sm">{label}</span>
        <span className="font-ui text-xs text-[var(--muted-foreground)]">
          {used} / {limit} today
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div
          className="h-full rounded-full bg-[var(--world-accent)]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
