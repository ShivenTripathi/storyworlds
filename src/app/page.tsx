import Link from "next/link";
import { Show, SignInButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-32 text-center">
      <p className="eyebrow mb-6">STORY WORLDS</p>
      <h1 className="font-display max-w-2xl text-5xl leading-tight sm:text-6xl">
        Great books, fully alive.
      </h1>
      <p className="font-ui mt-6 max-w-lg text-lg text-[var(--fg-muted,inherit)] opacity-70">
        Not summaries. Read the real thing — with the world rendered around
        you.
      </p>
      <div className="mt-10">
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button className="font-ui rounded-full bg-[var(--world-accent)] px-6 py-3 text-sm font-medium text-[var(--world-accent-fg,#fff)] transition-opacity hover:opacity-90">
              Begin reading
            </button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Link
            href="/shelf"
            className="font-ui inline-block rounded-full bg-[var(--world-accent)] px-6 py-3 text-sm font-medium text-[var(--world-accent-fg,#fff)] transition-opacity hover:opacity-90"
          >
            Go to your shelf
          </Link>
        </Show>
      </div>
    </main>
  );
}
