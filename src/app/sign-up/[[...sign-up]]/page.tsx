import type { Metadata } from "next";
import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Create your account — Story Worlds",
  description: "Create a free Story Worlds account to start reading.",
};

/**
 * Branded landing spot for the sign-up flow — the counterpart to
 * src/app/sign-in/[[...sign-in]]/page.tsx. See that file's comment for why
 * this exists: an in-app, EX LIBRIS-themed route instead of Clerk's hosted
 * Account Portal.
 */
export default function SignUpPage() {
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
          <p className="eyebrow mt-6 mb-2">Join</p>
          <h1 className="font-display text-3xl leading-tight sm:text-4xl">
            Create your account
          </h1>
          <p className="mt-3 font-ui text-sm text-muted-foreground">
            Free to start — no card required.
          </p>
        </div>

        <SignUp />
      </div>
    </div>
  );
}
