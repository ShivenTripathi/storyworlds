const STEPS = [
  {
    numeral: "I",
    title: "Bring a book",
    body: "Upload any PDF. We extract the full text — nothing trimmed, nothing rewritten. The book stays whole.",
  },
  {
    numeral: "II",
    title: "The world awakens",
    body: "Characters, places and scenes surface as you read — quietly, in the background, never ahead of you.",
  },
  {
    numeral: "III",
    title: "Step inside",
    body: "Talk to characters who only know what you know. No future chapters, no spoilers, no shortcuts.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto w-full max-w-5xl px-6 py-24">
      <p className="eyebrow mb-3 text-center">How it works</p>
      <h2 className="font-display mx-auto max-w-xl text-center text-3xl leading-tight sm:text-4xl">
        The text stays whole. Everything else comes alive around it.
      </h2>

      <div className="mt-14 grid gap-6 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div
            key={step.numeral}
            className="relative rounded-lg border border-[var(--world-frame)] bg-[var(--world-surface)] p-6"
          >
            <div className="pointer-events-none absolute inset-1 rounded-md border border-[var(--world-frame)] opacity-60" />
            <div className="relative flex flex-col gap-3">
              <p className="eyebrow text-[var(--world-accent)]">
                {step.numeral}
              </p>
              <h3 className="font-display text-xl">{step.title}</h3>
              <p className="font-ui text-sm leading-relaxed text-[var(--muted-foreground)]">
                {step.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
