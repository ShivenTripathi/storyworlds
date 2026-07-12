export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--border)] px-6 py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="font-display text-base tracking-tight">
            Story Worlds
          </span>
          <p className="mt-2 max-w-xs font-reading text-sm leading-relaxed text-[var(--muted-foreground)] italic">
            Never summarized. Never spoiled. Just illuminated.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="flex items-center gap-6 font-ui text-sm text-[var(--muted-foreground)]"
        >
          <a
            href="#how-it-works"
            className="transition-colors hover:text-[var(--foreground)] hover:underline hover:underline-offset-4"
          >
            How it works
          </a>
        </nav>
        <p className="font-ui text-xs text-[var(--muted-foreground)]">
          Made for readers. &copy; 2026
        </p>
      </div>
    </footer>
  );
}
