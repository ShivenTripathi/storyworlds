import { AuthCta } from "./AuthCta";
import { ScrollReveal } from "./ScrollReveal";

export function ClosingCta() {
  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-24 text-center">
      <ScrollReveal>
        <p className="eyebrow mb-4">Your shelf, waiting</p>
        <h2 className="font-display text-4xl leading-tight sm:text-5xl">
          Bring the book you have not finished.
        </h2>
        <p className="mx-auto mt-5 max-w-md font-reading text-base leading-relaxed text-[var(--muted-foreground)]">
          The one on the nightstand. The one from school. The one everyone
          quotes and no one reads past chapter three.
        </p>
        <div className="mt-9 flex justify-center">
          <AuthCta />
        </div>
      </ScrollReveal>
    </section>
  );
}
