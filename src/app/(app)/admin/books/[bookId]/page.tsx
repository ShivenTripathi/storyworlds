import Link from "next/link";
import { notFound } from "next/navigation";
import { BookDebugView } from "@/components/admin/BookDebugView";
import { requireUser } from "@/lib/auth";
import { getBookDebug } from "@/services/admin-debug";

type Params = { params: Promise<{ bookId: string }> };

export default async function AdminBookDebugPage({ params }: Params) {
  const { role } = await requireUser();

  if (role !== "admin") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
        <p className="eyebrow mb-6">THE PRESS ROOM</p>
        <h1 className="max-w-xl font-display text-4xl leading-tight sm:text-5xl">
          This door is locked.
        </h1>
        <p className="mt-6 max-w-md font-ui text-base opacity-70">
          The inspector is reserved for the library&apos;s keepers.
        </p>
      </div>
    );
  }

  const { bookId } = await params;
  const debug = await getBookDebug(bookId);
  if (!debug) notFound();

  return (
    <div>
      <nav className="mb-6 flex items-center gap-2 font-ui text-xs text-muted-foreground">
        <Link href="/admin" className="hover:text-foreground">
          ← Press Room
        </Link>
        <span aria-hidden>/</span>
        <span className="text-foreground">Inspector</span>
        <span aria-hidden>/</span>
        <Link
          href={`/books/${debug.book.id}`}
          className="hover:text-foreground"
        >
          Open in reader ↗
        </Link>
      </nav>
      <BookDebugView data={debug} />
    </div>
  );
}
