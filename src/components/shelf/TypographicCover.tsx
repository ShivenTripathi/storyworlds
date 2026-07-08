import { archetypeForBook } from "./archetypeForBook";

type CoverSize = "sm" | "md" | "lg";

interface TypographicCoverProps {
  bookId: string;
  title: string;
  author?: string | null;
  size?: CoverSize;
  className?: string;
  /** Real analyzed archetype; overrides the hash-based placeholder. */
  archetype?: string | null;
}

const TITLE_SIZE_CLASSES = {
  short: "text-2xl",
  medium: "text-xl",
  long: "text-base",
} as const;

function titleSizeFor(title: string): keyof typeof TITLE_SIZE_CLASSES {
  if (title.length <= 18) return "short";
  if (title.length <= 40) return "medium";
  return "long";
}

/**
 * A typographic, illustration-free book cover: the title set in Fraunces
 * on a "world" surface, framed like an engraved plate. Used on the shelf
 * grid, the continue-reading hero, and the book detail page. Deterministic
 * per-book archetype (via `data-world-theme`) stands in for real cover art
 * until M2's per-book world analysis lands.
 */
export function TypographicCover({
  bookId,
  title,
  author,
  size = "md",
  className = "",
  archetype: archetypeOverride,
}: TypographicCoverProps) {
  const archetype = archetypeOverride ?? archetypeForBook(bookId);
  const titleSize = titleSizeFor(title);

  return (
    <div
      data-world-theme={archetype}
      className={`relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-[var(--world-frame)] bg-[var(--world-surface)] ${className}`}
    >
      {/* engraved inset ring */}
      <div className="pointer-events-none absolute inset-1 rounded-md border border-[var(--world-frame)] opacity-60" />

      <div className="relative flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
        <span className="h-px w-10 bg-[var(--world-accent)]" aria-hidden="true" />
        <p
          className={`font-display leading-tight text-[var(--foreground)] line-clamp-4 ${TITLE_SIZE_CLASSES[titleSize]} ${
            size === "lg" ? "sm:text-3xl" : ""
          }`}
        >
          {title}
        </p>
        {author ? (
          <p className="font-ui text-[11px] tracking-wide text-[var(--muted-foreground)] uppercase">
            {author}
          </p>
        ) : null}
      </div>
    </div>
  );
}
