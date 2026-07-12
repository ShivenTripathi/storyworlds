import { ScrollReveal } from "./ScrollReveal";

const WORLDS = [
  { theme: "gothic", archetype: "Gothic", title: "Frankenstein" },
  {
    theme: "golden-age-scifi",
    archetype: "Golden-Age Sci-Fi",
    title: "The Time Machine",
  },
  { theme: "regency", archetype: "Regency", title: "Pride and Prejudice" },
  { theme: "desert-epic", archetype: "Desert Epic", title: "Dune" },
  { theme: "maritime", archetype: "Maritime", title: "Moby-Dick" },
  { theme: "mythic", archetype: "Mythic", title: "The Odyssey" },
] as const;

/**
 * Shows, rather than tells, that each book renders into its own visual
 * world: real titles, each carrying one of the twelve archetype palettes
 * defined in src/theme/archetypes.css via the `data-world-theme` attribute.
 * No book covers are faked — just the accent, frame, and surface a book's
 * world actually renders in.
 */
export function WorldArchetypes() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-24">
      <ScrollReveal>
        <p className="eyebrow mb-3 text-center">Every book, its own world</p>
        <h2 className="mx-auto max-w-xl text-center font-display text-3xl leading-tight sm:text-4xl">
          A gothic manor lights differently than a desert siege.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-center font-ui text-sm leading-relaxed text-[var(--muted-foreground)]">
          Twelve archetypes, tuned to the book — the frame changes. The words
          never do.
        </p>
      </ScrollReveal>

      <div className="landing-worlds-grid mt-12">
        {WORLDS.map((world, i) => (
          <ScrollReveal key={world.theme} delayMs={i * 70}>
            <div data-world-theme={world.theme} className="landing-world-card">
              <span className="landing-world-swatch" aria-hidden="true" />
              <p className="landing-world-archetype">{world.archetype}</p>
              <p className="landing-world-title">{world.title}</p>
            </div>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}
