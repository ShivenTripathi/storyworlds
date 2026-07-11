import type { Metadata } from "next";
import { HeroIlluminatedPage } from "@/components/marketing/HeroIlluminatedPage";
import { HowItWorks } from "@/components/marketing/HowItWorks";
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
      <HeroIlluminatedPage />
      <HowItWorks />
      <Manifesto />
      <SpoilerSafetyStrip />
      <MarketingFooter />
    </main>
  );
}
