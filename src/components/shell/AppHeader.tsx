"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { SoundToggle } from "@/components/sound/SoundToggle";

interface NavLink {
  href: string;
  label: string;
}

const NAV_LINKS: NavLink[] = [
  { href: "/shelf", label: "Shelf" },
  { href: "/settings", label: "Settings" },
];

/**
 * The app shell's top bar: wordmark, primary nav (Shelf / Settings, plus
 * Admin for admins), and the Clerk account menu. A skip-link precedes
 * everything so keyboard/screen-reader users can bypass it straight to
 * the page content.
 */
export function AppHeader() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
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
        if (!cancelled && role === "admin") setIsAdmin(true);
      } catch {
        // best-effort — the header just omits the Admin link
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const links = isAdmin
    ? [...NAV_LINKS, { href: "/admin", label: "Admin" }]
    : NAV_LINKS;

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
              {links.map((link) => {
                const active =
                  pathname === link.href ||
                  Boolean(pathname?.startsWith(`${link.href}/`));
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      aria-current={active ? "page" : undefined}
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
            </ul>
          </nav>
        </div>

        <div className="flex items-center gap-1.5">
          <SoundToggle />
          <div className="rounded-full focus-within:ring-2 focus-within:ring-[var(--ring)]">
            <UserButton />
          </div>
        </div>
      </header>
    </>
  );
}
