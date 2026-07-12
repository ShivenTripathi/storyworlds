import { ScrollReveal } from "./ScrollReveal";

/**
 * A concrete glimpse of the gamified Codex (src/components/codex/
 * CodexCardTile.tsx) — the collectible-card grid that fills in as a reader
 * meets each character. Mirrors that real component's visual language
 * exactly (the same fixed rarity palette: common -> ink, rare -> lapis,
 * epic -> lapis/oxblood, legendary -> ember — deliberately NOT
 * `--world-accent`, which is re-themed per book, so rarity stays a
 * consistent game-state signal here too) rather than inventing a new look,
 * so this reads as the actual product rather than an abstraction of it.
 *
 * Sample names are drawn from the same public-domain classics already named
 * in WorldArchetypes (no licensing concern, and it keeps the page's cast of
 * "example books" consistent). One tile is left locked/silhouette to also
 * carry the spoiler-safety idea: some of the cast simply hasn't been met
 * yet.
 *
 * The grid itself is illustrative chrome, not a real interactive Codex (it
 * links nowhere) — marked aria-hidden, same pattern as the SpoilerSafetyStrip
 * mock veil, so it doesn't read to assistive tech as a broken control.
 */

type SampleRarity = "common" | "rare" | "epic" | "legendary";

const RARITY_COLOR: Record<SampleRarity, string> = {
  common: "var(--ink-400)",
  rare: "var(--lapis-500)",
  epic: "color-mix(in srgb, var(--lapis-500) 45%, var(--oxblood-500))",
  legendary: "var(--ember-400)",
};

const CAST = [
  {
    name: "Elizabeth Bennet",
    book: "Pride and Prejudice",
    rarity: "rare" as const,
  },
  { name: "Captain Ahab", book: "Moby-Dick", rarity: "legendary" as const },
  {
    name: "The Time Traveller",
    book: "The Time Machine",
    rarity: "epic" as const,
  },
  {
    name: "Victor Frankenstein",
    book: "Frankenstein",
    rarity: "common" as const,
  },
];

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function DiscoveriesGlimpse() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-24">
      <ScrollReveal>
        <p className="eyebrow mb-3 text-center">Your Codex fills in</p>
        <h2 className="mx-auto max-w-xl text-center font-display text-3xl leading-tight sm:text-4xl">
          Every character you meet becomes a card.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-center font-ui text-sm leading-relaxed text-[var(--muted-foreground)]">
          A collectible dossier for everyone you&apos;ve encountered — rarer the
          more the story turns on them. Locked until you actually get there.
        </p>
      </ScrollReveal>

      <ScrollReveal delayMs={100}>
        <div aria-hidden="true" className="landing-codex-grid mt-12">
          {CAST.map((card) => (
            <div
              key={card.name}
              className="landing-codex-card"
              style={{ borderColor: RARITY_COLOR[card.rarity] }}
            >
              <div
                className="landing-codex-portrait"
                style={{
                  background: `linear-gradient(160deg, color-mix(in srgb, ${RARITY_COLOR[card.rarity]} 25%, var(--world-surface)), var(--world-surface))`,
                }}
              >
                <span
                  className="font-display text-4xl leading-none"
                  style={{ color: RARITY_COLOR[card.rarity] }}
                >
                  {initial(card.name)}
                </span>
              </div>
              <p className="landing-codex-name font-display">{card.name}</p>
              <p className="landing-codex-book font-ui">{card.book}</p>
              <span
                className="landing-codex-rarity font-ui"
                style={{
                  color: RARITY_COLOR[card.rarity],
                  borderColor: RARITY_COLOR[card.rarity],
                }}
              >
                {card.rarity}
              </span>
            </div>
          ))}

          {/* One tile stays locked — the frontier hasn't reached this one yet. */}
          <div className="landing-codex-card landing-codex-card--locked">
            <div className="landing-codex-portrait landing-codex-portrait--locked">
              <span className="landing-codex-seal">?</span>
            </div>
            <p className="landing-codex-name font-display text-[var(--muted-foreground)]">
              Not yet discovered
            </p>
            <p className="landing-codex-book font-ui italic">Keep reading.</p>
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}
