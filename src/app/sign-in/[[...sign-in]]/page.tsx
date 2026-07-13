import type { Metadata } from "next";
import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Sign in — Story Worlds",
  description: "Sign in to keep reading, right where you left off.",
};

/**
 * Branded landing spot for the sign-in flow. Clerk's <SignIn/> auto-detects
 * routing from this catch-all segment (no `path`/`routing` props needed —
 * see https://clerk.com/docs/references/nextjs/custom-sign-in-or-up-page),
 * so this page just supplies the EX LIBRIS frame around it: previously,
 * signed-out deep links bounced straight to Clerk's hosted Account Portal,
 * which broke the "lamplit library" feel at the exact moment someone was
 * trying to get in.
 */
export default function SignInPage() {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link
            href="/"
            className="font-display text-lg tracking-tight focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          >
            Story Worlds
          </Link>
          <p className="eyebrow mt-6 mb-2">Welcome back</p>
          <h1 className="font-display text-3xl leading-tight sm:text-4xl">
            Sign in
          </h1>
          <p className="mt-3 font-ui text-sm text-muted-foreground">
            Pick up your books right where you left off.
          </p>
        </div>

        <SignIn />
      </div>
    </div>
  );
}
