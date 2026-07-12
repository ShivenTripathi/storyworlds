import { ScrollReveal } from "./ScrollReveal";

export function Manifesto() {
  return (
    <section className="border-y border-[var(--border)] bg-[var(--card)]">
      <div className="mx-auto w-full max-w-2xl px-6 py-24 text-center">
        <ScrollReveal>
          <p className="font-display text-2xl leading-relaxed sm:text-3xl">
            We will never summarize.
            <br />
            <em className="text-[var(--world-accent)] not-italic">
              Reading is hard. It should be.
            </em>
            <br />
            We just make it alive.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}
