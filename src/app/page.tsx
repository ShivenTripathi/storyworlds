import type { Metadata } from "next";
import { AuthCta } from "@/components/marketing/AuthCta";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { ArchetypeStrip } from "@/components/marketing/ArchetypeStrip";
import { Manifesto } from "@/components/marketing/Manifesto";
import { SpoilerSafetyStrip } from "@/components/marketing/SpoilerSafetyStrip";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const metadata: Metadata = {
  title: "Story Worlds — Great books, fully alive",
  description:
    "Not summaries. Not shortcuts. Read the real thing — with the world rendered around you.",
  openGraph: {
    title: "Story Worlds — Great books, fully alive",
    description:
      "Not summaries. Not shortcuts. Read the real thing — with the world rendered around you.",
    type: "website",
  },
};

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <div className="flex flex-col items-center px-6 pt-32 pb-24 text-center">
        <p className="eyebrow mb-6">STORY WORLDS</p>
        <h1 className="font-display max-w-2xl text-5xl leading-tight sm:text-6xl">
          Great books, fully alive.
        </h1>
        <span
          className="mt-6 h-px w-16 bg-[var(--world-accent)]"
          aria-hidden="true"
        />
        <p className="font-ui mt-6 max-w-lg text-lg text-[var(--muted-foreground)]">
          Not summaries. Not shortcuts. Read the real thing — with the world
          rendered around you.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
          <AuthCta />
          <a
            href="#how-it-works"
            className="font-ui text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            How it works ↓
          </a>
        </div>
      </div>

      <HowItWorks />
      <ArchetypeStrip />
      <Manifesto />
      <SpoilerSafetyStrip />
      <MarketingFooter />
    </main>
  );
}
