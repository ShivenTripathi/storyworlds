export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--border)] px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
        <span className="font-display text-base tracking-tight">
          Story Worlds
        </span>
        <p className="font-ui text-xs text-[var(--muted-foreground)]">
          Made for readers. &copy; 2026
        </p>
      </div>
    </footer>
  );
}
