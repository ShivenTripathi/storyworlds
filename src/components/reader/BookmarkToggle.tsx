"use client";

interface BookmarkToggleProps {
  bookmarked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Header "bookmark the current page" toggle — a manual saved spot, distinct
 * from the automatic `reading_progress.currentChunk` marker (Kindle has
 * both too). Same trigger styling as the World/Contents/Soundscape buttons
 * beside it in the reader's header cluster.
 */
export function BookmarkToggle({
  bookmarked,
  onToggle,
  disabled,
  className,
}: BookmarkToggleProps) {
  return (
    <button
      type="button"
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"}
      aria-pressed={bookmarked}
      disabled={disabled}
      onClick={onToggle}
      className={`flex h-11 min-w-11 items-center justify-center rounded-full border px-3.5 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50 ${className ?? ""}`}
      style={{
        background: "var(--card)",
        borderColor: bookmarked ? "var(--world-accent)" : "var(--border)",
        color: bookmarked ? "var(--world-accent)" : "var(--card-foreground)",
      }}
    >
      <BookmarkGlyph filled={bookmarked} />
    </button>
  );
}

function BookmarkGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 2.5h9v11l-4.5-2.8-4.5 2.8v-11z" />
    </svg>
  );
}
