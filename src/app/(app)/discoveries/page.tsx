import { ReaderDashboard } from "@/components/analytics/ReaderDashboard";
import { ReadingHeatmap } from "@/components/analytics/ReadingHeatmap";
import { CollectionOverview } from "@/components/analytics/CollectionOverview";

export default function DiscoveriesPage() {
  return (
    <div>
      <div className="mb-10">
        <p className="eyebrow mb-2">YOUR PROGRESS</p>
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">
          Discoveries
        </h1>
        <p className="mt-4 max-w-xl font-ui text-sm text-muted-foreground">
          Everything you&apos;ve read, met, and chatted with — across every
          world you&apos;ve opened.
        </p>
      </div>

      <ReadingHeatmap className="mb-10" />
      <ReaderDashboard className="mb-14" />
      <CollectionOverview />
    </div>
  );
}
