"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth, UserButton } from "@clerk/nextjs";
import { FeedbackWidget } from "@/components/feedback/FeedbackWidget";
import { SoundToggle } from "@/components/sound/SoundToggle";

// The immersive reader (src/components/reader/Reader.tsx) renders its own
// full-screen chrome over this header, so the Feedback trigger is hidden
// there rather than sitting behind it, unreachable but still tab-focusable.
const IMMERSIVE_READER_RE = /^\/books\/[^/]+\/read(\/|$)/;

interface NavLink {
  href: string;
  label: string;
}

const NAV_LINKS: NavLink[] = [
  { href: "/shelf", label: "Shelf" },
  { href: "/discoveries", label: "Discoveries" },
  { href: "/settings", label: "Settings" },
];

// 'unknown' while admin status is still resolving (either Clerk itself
// hasn't loaded, or the /api/me fallback fetch below is in flight).
type AdminStatus = "unknown" | "admin" | "not-admin";

/**
 * Reads an app role off the Clerk session claims, if one happens to be
 * there (e.g. a custom JWT template mirroring `publicMetadata.role`). Our
 * role today lives only in the `users` table (see src/lib/auth.ts /
 * requireUser), not on the Clerk session, so this is a forward-compatible
 * fast path rather than the primary source — it lets a future claims-based
 * setup skip the network roundtrip below entirely.
 */
function roleFromSessionClaims(claims: unknown): string | undefined {
  if (!claims || typeof claims !== "object") return undefined;
  const c = claims as Record<string, unknown>;
  const metadata = c.metadata ?? c.publicMetadata;
  if (metadata && typeof metadata === "object") {
    const role = (metadata as Record<string, unknown>).role;
    if (typeof role === "string") return role;
  }
  return typeof c.role === "string" ? c.role : undefined;
}

/**
 * The app shell's top bar: wordmark, primary nav (Shelf / Discoveries /
 * Settings, plus Admin for admins), and the Clerk account menu. A skip-link
 * precedes everything so keyboard/screen-reader users can bypass it
 * straight to the page content.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { sessionClaims } = useAuth();
  // Derived synchronously from what Clerk already gave us this render — no
  // effect needed for this branch, so when it resolves it never causes an
  // extra render/reflow after paint.
  const claimRole = roleFromSessionClaims(sessionClaims);
  const [fetchedStatus, setFetchedStatus] = useState<AdminStatus>("unknown");

  useEffect(() => {
    // Fast path already answered it above — skip the network roundtrip
    // entirely (nothing to synchronize here, so no setState in this branch).
    if (claimRole) return;

    // Fallback: our role isn't on the Clerk session, so ask the API. This
    // is the roundtrip the audit flagged as a post-paint flicker risk — the
    // Admin <li> below stays mounted (just visually hidden) the whole time
    // so resolving it can never shift surrounding layout.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me");
        if (!res.ok) return;
        const data: unknown = await res.json().catch(() => null);
        const role =
          data && typeof data === "object" && "user" in data
            ? (data as { user?: { role?: string } }).user?.role
            : undefined;
        if (!cancelled) {
          setFetchedStatus(role === "admin" ? "admin" : "not-admin");
        }
      } catch {
        if (!cancelled) setFetchedStatus("not-admin");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimRole]);

  const adminStatus: AdminStatus = claimRole
    ? claimRole === "admin"
      ? "admin"
      : "not-admin"
    : fetchedStatus;
  const adminActive =
    pathname === "/admin" || Boolean(pathname?.startsWith("/admin/"));

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-[var(--primary)] focus-visible:px-4 focus-visible:py-2 focus-visible:font-ui focus-visible:text-sm focus-visible:font-medium focus-visible:text-[var(--primary-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] focus-visible:outline-none"
      >
        Skip to content
      </a>

      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-8">
          <Link
            href="/shelf"
            className="shrink-0 rounded-md font-display text-base tracking-tight focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none sm:text-lg"
          >
            Story Worlds
          </Link>

          <nav aria-label="Primary" className="min-w-0">
            <ul className="flex items-center gap-4 sm:gap-6">
              {NAV_LINKS.map((link) => {
                const active =
                  pathname === link.href ||
                  Boolean(pathname?.startsWith(`${link.href}/`));
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      data-sound={
                        link.href === "/discoveries" ? "tick" : undefined
                      }
                      className={`rounded-md px-1 py-1 font-ui text-sm transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none ${
                        active
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
              {/* Mounted for 'unknown' too (not just 'admin') so the slot's
                  width is already reserved — invisible, but taking up
                  layout space — before we know the answer. That way an
                  admin session reveals the link with zero reflow instead of
                  the roundtrip abruptly inserting it after paint. For the
                  common non-admin case this unmounts entirely once resolved
                  (a small early shrink, not a jarring pop-in). */}
              {adminStatus !== "not-admin" && (
                <li
                  aria-hidden={adminStatus !== "admin"}
                  className={adminStatus === "admin" ? undefined : "invisible"}
                >
                  <Link
                    href="/admin"
                    tabIndex={adminStatus === "admin" ? undefined : -1}
                    aria-current={adminActive ? "page" : undefined}
                    className={`rounded-md px-1 py-1 font-ui text-sm transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none ${
                      adminActive
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Admin
                  </Link>
                </li>
              )}
            </ul>
          </nav>
        </div>

        <div className="flex items-center gap-1.5">
          {!IMMERSIVE_READER_RE.test(pathname ?? "") ? (
            <FeedbackWidget />
          ) : null}
          <SoundToggle />
          <div className="rounded-full focus-within:ring-2 focus-within:ring-[var(--ring)]">
            <UserButton />
          </div>
        </div>
      </header>
    </>
  );
}
