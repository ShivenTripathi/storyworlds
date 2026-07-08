import { TypographicCover } from "@/components/shelf/TypographicCover";
import type { Archetype } from "@/theme/archetypes";

const DEMO_ARCHETYPES: Archetype[] = [
  "classic",
  "noir",
  "desert-epic",
  "regency",
];

/**
 * The signature-feature demo: the same mock book rendered once per
 * archetype, to show that world theming is chosen by the story itself —
 * not a single house style.
 */
export function ArchetypeStrip() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-24">
      <p className="eyebrow mb-3 text-center">One book, twelve worlds</p>
      <h2 className="font-display mx-auto max-w-xl text-center text-3xl leading-tight sm:text-4xl">
        Every book wears its own world.
      </h2>

      <div className="mt-12 grid grid-cols-2 gap-5 sm:grid-cols-4">
        {DEMO_ARCHETYPES.map((archetype) => (
          <TypographicCover
            key={archetype}
            bookId={`demo:${archetype}`}
            title="The Caves of Steel"
            author="Isaac Asimov"
            size="sm"
            archetype={archetype}
          />
        ))}
      </div>

      <p className="font-ui mx-auto mt-8 max-w-md text-center text-sm text-[var(--muted-foreground)]">
        Every book wears its own world. Twelve hand-set themes, chosen by the
        story itself.
      </p>
    </section>
  );
}
