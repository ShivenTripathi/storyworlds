"use client";

import Link from "next/link";
import { Show, SignInButton } from "@clerk/nextjs";

interface AuthCtaProps {
  /** Button label while signed out (opens the Clerk sign-in modal). */
  signedOutLabel?: string;
  /** Link label once signed in. */
  signedInLabel?: string;
  /** Link destination once signed in. */
  signedInHref?: string;
}

/**
 * The only client-interactive piece of the landing page: the primary CTA,
 * which needs to know whether the visitor is signed in. Isolated here so
 * the rest of the page can render statically.
 *
 * Labels/href are overridable so a tailored surface (e.g. the shared-link
 * funnel entry in HeroIlluminatedPage) can point the same signed-in/signed-out
 * behavior at different copy/destinations without duplicating the
 * Show/SignInButton wiring.
 */
export function AuthCta({
  signedOutLabel = "Begin reading",
  signedInLabel = "Go to your shelf",
  signedInHref = "/shelf",
}: AuthCtaProps = {}) {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="rounded-full bg-[var(--world-accent)] px-6 py-3 font-ui text-sm font-medium text-[var(--world-accent-fg,#fff)] transition-opacity hover:opacity-90">
            {signedOutLabel}
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <Link
          href={signedInHref}
          className="inline-block rounded-full bg-[var(--world-accent)] px-6 py-3 font-ui text-sm font-medium text-[var(--world-accent-fg,#fff)] transition-opacity hover:opacity-90"
        >
          {signedInLabel}
        </Link>
      </Show>
    </>
  );
}
