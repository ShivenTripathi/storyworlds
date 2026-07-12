import { AuthCta } from "./AuthCta";
import { ScrollReveal } from "./ScrollReveal";

/**
 * The signature element of the landing page: a book page whose world blooms
 * in its margin. Running prose (Literata — the actual reading face) carries a
 * character's name; a hairline "leader" connects it to an illuminated dossier
 * plate and a scene chip that materialize beside the text. This is the product
 * itself — text becoming a world, anchored to the page, never ahead of the
 * reader — rather than a description of it.
 *
 * Copy note: the passage is original (no third-party text), so nothing here
 * carries a licensing concern.
 */
export function HeroIlluminatedPage() {
  return (
    <section className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-14 px-6 pt-24 pb-20 lg:grid-cols-[1fr_1.05fr] lg:gap-10 lg:pt-28">
      {/* Left: the thesis, in words — settles in first, staggered */}
      <div className="max-w-xl">
        <ScrollReveal>
          <p className="eyebrow mb-5">An illustrated reading companion</p>
        </ScrollReveal>
        <ScrollReveal delayMs={90}>
          <h1 className="font-display text-5xl leading-[1.05] sm:text-6xl">
            Great books,
            <br />
            fully alive.
          </h1>
        </ScrollReveal>
        <ScrollReveal delayMs={160}>
          <p className="mt-7 font-reading text-lg leading-relaxed text-[var(--muted-foreground)]">
            You bring the book. Its world — the characters, the places, the
            scenes themselves — takes shape in the margins as you read. Never
            summarized. Never spoiled.
          </p>
        </ScrollReveal>
        <ScrollReveal delayMs={230}>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <AuthCta />
            <a
              href="#how-it-works"
              className="font-ui text-sm text-[var(--muted-foreground)] underline-offset-4 transition-colors hover:text-[var(--foreground)] hover:underline"
            >
              See how it works ↓
            </a>
          </div>
        </ScrollReveal>
      </div>

      {/* Right: the thesis, made real — the illuminated page */}
      <div className="illuminated" aria-hidden="true">
        <div className="landing-hero-glow" />
        <div className="page">
          <p className="folio">Chapter Nine · The Long Descent</p>

          <p className="prose">
            The lift had not moved in a hundred years, and yet it carried them
            down without complaint. In the dark{" "}
            <span className="named">
              Elidor Vance
              <span className="leader" />
            </span>{" "}
            counted the floors by the cold seams of rock, and said nothing of
            the door he had sealed above them, nor of the promise it had cost.
          </p>

          <p className="prose">
            When the doors opened on the salt-lit cavern, she was already
            waiting, as if the years between had been a courtesy she had chosen
            to extend.
          </p>

          {/* Marginalia: a place/timeline note */}
          <figure className="plate plate-note">
            <span className="plate-note-glyph">⏱</span>
            <figcaption className="plate-note-text">
              A hundred years since the lift last stopped
            </figcaption>
          </figure>

          {/* Marginalia: a character dossier plate */}
          <figure className="plate plate-char landing-plate--drift">
            <div className="portrait">
              <span className="portrait-glyph">EV</span>
            </div>
            <figcaption>
              <p className="plate-eyebrow">On this page</p>
              <p className="plate-name">Elidor Vance</p>
              <p className="plate-role">
                Archivist of the Deep Reaches. Keeps one door he will not open.
              </p>
            </figcaption>
          </figure>

          {/* Marginalia: a scene chip */}
          <figure className="plate plate-scene landing-plate--drift">
            <div className="scene-frame">
              <span className="scene-eyebrow">The scene</span>
              <span className="scene-line" />
              <span className="scene-line short" />
            </div>
            <figcaption className="scene-cap">
              A salt-lit cavern, a hundred floors down.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
