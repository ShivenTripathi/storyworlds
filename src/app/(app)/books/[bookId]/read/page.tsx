import { Reader } from "@/components/reader/Reader";

interface ReadPageProps {
  params: Promise<{ bookId: string }>;
}

export default async function ReadPage({ params }: ReadPageProps) {
  const { bookId } = await params;
  return <Reader bookId={bookId} />;
}
