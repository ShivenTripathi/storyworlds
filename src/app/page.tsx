import type { Metadata } from "next";
import { cache } from "react";
import "@/components/marketing/marketing.css";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import {
  HeroIlluminatedPage,
  type HeroFunnel,
} from "@/components/marketing/HeroIlluminatedPage";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { Manifesto } from "@/components/marketing/Manifesto";
import { WorldArchetypes } from "@/components/marketing/WorldArchetypes";
import { DiscoveriesGlimpse } from "@/components/marketing/DiscoveriesGlimpse";
import { SpoilerSafetyStrip } from "@/components/marketing/SpoilerSafetyStrip";
import { ClosingCta } from "@/components/marketing/ClosingCta";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { env } from "@/lib/env";
import { getBook } from "@/services/books";

type SearchParams = Record<string, string | string[] | undefined>;

interface HomeProps {
  searchParams: Promise<SearchParams>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Resolves `?book=<id>` to a book, de-duped per request via React's
 * `cache()` — generateMetadata and Home both need this same lookup, and
 * this collapses them into a single DB read (see getBook in
 * src/services/books.ts).
 *
 * Fails CLOSED, same as /api/og/book: a malformed id, an unknown id, or a
 * book whose visibility isn't 'published' all resolve to `null` — nothing
 * about a private book (its existence, title, author) is ever allowed to
 * shape this page's metadata or funnel copy, regardless of what a crafted
 * `?book=` query claims.
 */
const resolveSharedBook = cache(async (bookId: string | undefined) => {
  if (!bookId || !UUID_RE.test(bookId)) return null;
  try {
    const book = await getBook(bookId);
    if (book && book.visibility === "published") return book;
  } catch {
    // DB hiccup or malformed id slipping past the regex — degrade to "no
    // shared book" rather than a broken page.
  }
  return null;
});

const DEFAULT_TITLE = "Story Worlds — Great books, fully alive";
const DEFAULT_DESCRIPTION =
  "Not summaries. Not shortcuts. Read the full text — illustrated, spoiler-safe, and free to start.";

/**
 * The landing page unfurls two different ways when a link gets pasted
 * somewhere (Slack, iMessage, Twitter/X, etc.):
 *
 *  - Default (no `?book=`, or the id doesn't resolve to a published book):
 *    a branded, static site card (`/api/og/site`) — no DB read needed.
 *  - Shared-book link (`?book=<published-id>`, optionally `?cast=&total=&
 *    days=` echoed from ShareButton's buildShareUrls): the SAME
 *    `/api/og/book/:id` card the sharer saw/saved, so the unfurled image
 *    matches what was actually shared instead of a generic fallback.
 */
export async function generateMetadata({
  searchParams,
}: HomeProps): Promise<Metadata> {
  const sp = await searchParams;
  const book = await resolveSharedBook(first(sp.book));
  const metadataBase = new URL(env.APP_URL);

  if (book) {
    const ogParams = new URLSearchParams();
    for (const key of ["cast", "total", "days"] as const) {
      const value = first(sp[key]);
      if (value) ogParams.set(key, value);
    }
    const qs = ogParams.toString();
    const ogImage = `/api/og/book/${book.id}${qs ? `?${qs}` : ""}`;
    const title = book.author
      ? `${book.title} by ${book.author} — Story Worlds`
      : `${book.title} — Story Worlds`;
    const description = `Read "${book.title}" on Story Worlds — the full text, illustrated and spoiler-safe. Free to start.`;

    return {
      metadataBase,
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        images: [{ url: ogImage, width: 1200, height: 630 }],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [ogImage],
      },
    };
  }

  return {
    metadataBase,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    openGraph: {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      type: "website",
      images: [{ url: "/api/og/site", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      images: ["/api/og/site"],
    },
  };
}

export default async function Home({ searchParams }: HomeProps) {
  const sp = await searchParams;
  const ref = first(sp.ref);
  const book = await resolveSharedBook(first(sp.book));

  // Only visitors who actually followed a share link (`?ref=share-*`) get
  // the tailored hero — a bare `?book=` with no `ref` isn't a funnel entry,
  // it just degrades to the normal landing page.
  let funnel: HeroFunnel | undefined;
  if (ref?.startsWith("share-")) {
    funnel = book
      ? { kind: "book", book: { title: book.title, author: book.author } }
      : { kind: "generic" };
  }

  return (
    <>
      <MarketingHeader />
      {/* overflow-x-clip contains the hero's decorative bleed (glow / rotated
          page) so it never triggers horizontal body scroll on phones. The
          sticky header is a sibling, so its stickiness is unaffected. */}
      <main className="flex flex-1 flex-col overflow-x-clip">
        <HeroIlluminatedPage funnel={funnel} />
        <HowItWorks />
        <Manifesto />
        <WorldArchetypes />
        <DiscoveriesGlimpse />
        <SpoilerSafetyStrip />
        <ClosingCta />
        <MarketingFooter />
      </main>
    </>
  );
}
