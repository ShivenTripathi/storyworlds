import { Reader } from "@/components/reader/Reader";

interface ReadPageProps {
  params: Promise<{ bookId: string }>;
  /** `?chunk=N` deep-links straight to a 0-based chunk index — used by the
   * story insights timeline (src/components/analytics/BookInsights.tsx) to
   * jump back to an already-revealed beat, or ahead to one just unlocked. */
  searchParams: Promise<{ chunk?: string }>;
}

export default async function ReadPage({
  params,
  searchParams,
}: ReadPageProps) {
  const { bookId } = await params;
  const { chunk } = await searchParams;
  const parsed = chunk !== undefined ? Number(chunk) : NaN;
  const initialChunk =
    Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  return <Reader bookId={bookId} initialChunk={initialChunk} />;
}
