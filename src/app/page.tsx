import type { Metadata } from "next";
import "@/components/marketing/marketing.css";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { HeroIlluminatedPage } from "@/components/marketing/HeroIlluminatedPage";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { Manifesto } from "@/components/marketing/Manifesto";
import { WorldArchetypes } from "@/components/marketing/WorldArchetypes";
import { SpoilerSafetyStrip } from "@/components/marketing/SpoilerSafetyStrip";
import { ClosingCta } from "@/components/marketing/ClosingCta";
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
    <>
      <MarketingHeader />
      {/* overflow-x-clip contains the hero's decorative bleed (glow / rotated
          page) so it never triggers horizontal body scroll on phones. The
          sticky header is a sibling, so its stickiness is unaffected. */}
      <main className="flex flex-1 flex-col overflow-x-clip">
        <HeroIlluminatedPage />
        <HowItWorks />
        <Manifesto />
        <WorldArchetypes />
        <SpoilerSafetyStrip />
        <ClosingCta />
        <MarketingFooter />
      </main>
    </>
  );
}
