"use client";

import { useEffect, useState } from "react";

/** Mirrors FunFact (src/domain/schemas.ts) as it appears on BookDto.funFacts. */
export interface FunFactItem {
  text: string;
  category: "author" | "history" | "trivia" | "legacy";
}

const CATEGORY_LABEL: Record<FunFactItem["category"], string> = {
  author: "The author",
  history: "History",
  trivia: "Trivia",
  legacy: "Legacy",
};

const ROTATE_MS = 7000;

/**
 * "Did you know?" card for the book-detail page — a spoiler-free, real-world
 * "before you begin" teaser (author life, publication context, trivia,
 * legacy) meant to make a reader want to open the book. Purely a product
 * enhancement: renders nothing when `facts` is empty, so a book with no
 * generated facts yet (or none the model was confident enough to write —
 * see FunFactsSchema) shows no placeholder at all.
 *
 * Auto-rotates through the facts one at a time (paused on hover/focus so it
 * never yanks a reader's attention mid-read), with dot navigation for direct,
 * accessible jumps — a single fact renders as a static card with no controls.
 */
export function FunFactsCard({ facts }: { facts: FunFactItem[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (facts.length <= 1 || paused) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % facts.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [facts.length, paused]);

  if (facts.length === 0) return null;

  // Guard against `index` being stale if `facts` ever shrinks between renders.
  const fact = facts[index % facts.length];

  return (
    // Hover/focus here only pauses the auto-rotate timer (a UX nicety, not a
    // real interaction) — the actual interactive elements are the dot
    // buttons below, which already have their own roles/labels/keyboard
    // support.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <section
      className="rounded-lg border border-border bg-card p-6"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="flex items-center justify-between gap-4">
        <p className="eyebrow">DID YOU KNOW?</p>
        <span className="rounded-full border border-border px-2.5 py-0.5 font-ui text-[10px] tracking-wide text-muted-foreground uppercase">
          {CATEGORY_LABEL[fact.category]}
        </span>
      </div>

      <p
        key={index}
        className="mt-3 min-h-[3.5rem] font-reading text-[15px] leading-relaxed text-foreground"
      >
        {fact.text}
      </p>

      {facts.length > 1 ? (
        <div
          className="mt-4 flex items-center gap-1.5"
          role="tablist"
          aria-label="Fun facts about this book"
        >
          {facts.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Fact ${i + 1} of ${facts.length}`}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === index
                  ? "w-5 bg-[var(--primary)]"
                  : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              }`}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
