"use client";

import Link from "next/link";
import { Show, SignInButton } from "@clerk/nextjs";

/**
 * The only client-interactive piece of the landing page: the primary CTA,
 * which needs to know whether the visitor is signed in. Isolated here so
 * the rest of the page can render statically.
 */
export function AuthCta() {
  return (
    <>
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
    </>
  );
}
