export function SpoilerSafetyStrip() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-24">
      <div className="grid items-center gap-10 sm:grid-cols-2">
        <div>
          <p className="eyebrow mb-3">Spoiler safety</p>
          <h2 className="font-display text-3xl leading-tight sm:text-4xl">
            <span aria-hidden="true">&#128274;</span> The world never runs
            ahead of you.
          </h2>
          <p className="font-ui mt-4 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
            Everything is gated by where YOU are in the book. Characters,
            places and world reference unlock exactly as you reach them —
            never a page sooner.
          </p>
        </div>

        {/* Static mock veil — not the real reader component */}
        <div className="relative overflow-hidden rounded-lg border border-[var(--world-frame)] bg-[var(--world-surface)] p-6">
          <div className="space-y-2 blur-[3px] select-none" aria-hidden="true">
            <div className="h-3 w-11/12 rounded bg-[var(--muted-foreground)] opacity-30" />
            <div className="h-3 w-full rounded bg-[var(--muted-foreground)] opacity-30" />
            <div className="h-3 w-4/5 rounded bg-[var(--muted-foreground)] opacity-30" />
            <div className="h-3 w-full rounded bg-[var(--muted-foreground)] opacity-30" />
            <div className="h-3 w-3/5 rounded bg-[var(--muted-foreground)] opacity-30" />
          </div>
          <div className="mt-5 flex justify-center">
            <span className="font-ui rounded-full border border-[var(--world-frame)] bg-[var(--background)] px-4 py-1.5 text-xs text-[var(--muted-foreground)]">
              Unlocks at Chapter 12
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
