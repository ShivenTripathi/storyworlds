import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export function AppHeader() {
  return (
    <header className="flex items-center justify-between border-b border-[var(--border,rgba(128,128,128,0.2))] px-6 py-4">
      <Link href="/shelf" className="font-display text-lg tracking-tight">
        Story Worlds
      </Link>
      <UserButton />
    </header>
  );
}
