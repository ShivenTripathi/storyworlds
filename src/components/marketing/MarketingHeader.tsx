"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthCta } from "./AuthCta";

/**
 * Slim sticky header for the marketing page. The only reason this is a
 * client component is the scroll listener that reveals the hairline border +
 * blur once the page has moved — the rest of the header is static markup.
 */
export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="landing-header" data-scrolled={scrolled}>
      <div className="landing-header__inner">
        <Link href="/" className="landing-header__wordmark font-display">
          Story Worlds
        </Link>
        <nav className="landing-header__nav" aria-label="Primary">
          <a href="#how-it-works" className="landing-header__link font-ui">
            How it works
          </a>
          <div className="landing-header__cta">
            <AuthCta />
          </div>
        </nav>
      </div>
    </header>
  );
}
