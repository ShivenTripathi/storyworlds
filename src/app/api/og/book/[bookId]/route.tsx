import { ImageResponse } from "next/og";
import { z } from "zod";
import { dbReady } from "@/db";
import { getBook } from "@/services/books";
import { Frame } from "../../_lib/Frame";
import { OG_COLORS, OG_FONT_DISPLAY, OG_SIZE } from "../../_lib/theme";

/**
 * Public, unauthenticated Open Graph card for a book's collection/share
 * progress — social crawlers (link unfurlers) fetch this with no session,
 * so it must never leak a private book's title, author, or any per-entity
 * detail. See CLAUDE.md spoiler-frontier invariant and the zero-cost /
 * card-free constraint (no external asset fetches here beyond the DB read).
 *
 * GET /api/og/book/:bookId
 *   ?cast=<int>   — cast met, aggregate only (e.g. 8)
 *   ?total=<int>  — cast total, aggregate only (e.g. 13)
 *   ?days=<int>   — days-to-finish or reading-streak, aggregate only (e.g. 11)
 *
 * These three numbers are NOT re-derived from analytics here — the in-app
 * share flow (an authenticated page) already called getBookStats/
 * getCodexForBook for the current reader and put the resulting aggregate
 * numbers on the URL. Spoofing them via a hand-crafted link only vandalizes
 * that one vanity card (acceptable per spec); it can never surface another
 * reader's data because nothing reader-specific is looked up server-side.
 *
 * The ONLY server-side lookup is the book's own visibility: a private/
 * unknown book always renders the generic branded fallback, regardless of
 * query params, so a guessed bookId can't be used to fish for a private
 * book's existence, title, or author.
 */

const queryHint = z.object({
  cast: z.coerce.number().int().min(0).max(100_000).optional(),
  total: z.coerce.number().int().min(0).max(100_000).optional(),
  days: z.coerce.number().int().min(0).max(100_000).optional(),
  /** A reader-selected passage, from the reading-column "Share quote" action
   * (see src/components/reader/SelectionPopover.tsx + ShareButton's "quote"
   * kind). Truncated defensively even though the client already caps it. */
  quote: z.string().max(400).optional(),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_TITLE_LEN = 90;
const MAX_AUTHOR_LEN = 60;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function FallbackCard() {
  return (
    <Frame>
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 22,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: OG_COLORS.ember,
            marginBottom: 24,
          }}
        >
          Story Worlds
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: OG_FONT_DISPLAY,
            fontSize: 64,
            lineHeight: 1.15,
            color: OG_COLORS.text,
            maxWidth: 820,
          }}
        >
          A private world on Story Worlds
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 20,
            fontSize: 26,
            color: OG_COLORS.muted,
            maxWidth: 760,
          }}
        >
          This reader keeps this one to themselves.
        </div>
      </div>
    </Frame>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        paddingRight: 40,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 40,
          color: OG_COLORS.text,
          fontFamily: OG_FONT_DISPLAY,
        }}
      >
        {value}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 18,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          color: OG_COLORS.gild,
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function BookCard({
  title,
  author,
  cast,
  total,
  days,
}: {
  title: string;
  author: string | null;
  cast?: number;
  total?: number;
  days?: number;
}) {
  const chips: Array<{ label: string; value: string }> = [];
  if (cast !== undefined && total !== undefined) {
    const clampedCast = Math.max(0, Math.min(cast, total));
    chips.push({
      label: "Cast discovered",
      value: `${clampedCast} / ${total}`,
    });
  }
  if (days !== undefined) {
    chips.push({ label: "Days reading", value: `${days}` });
  }

  return (
    <Frame>
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 20,
            letterSpacing: 5,
            textTransform: "uppercase",
            color: OG_COLORS.ember,
            marginBottom: 22,
          }}
        >
          From my shelf
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: OG_FONT_DISPLAY,
            fontSize: 60,
            lineHeight: 1.1,
            color: OG_COLORS.text,
            maxWidth: 900,
          }}
        >
          {title}
        </div>
        {author ? (
          <div
            style={{
              display: "flex",
              marginTop: 16,
              fontSize: 28,
              color: OG_COLORS.muted,
            }}
          >
            {author}
          </div>
        ) : null}

        {chips.length > 0 ? (
          <div style={{ display: "flex", marginTop: 48 }}>
            {chips.map((c) => (
              <StatChip key={c.label} label={c.label} value={c.value} />
            ))}
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

const MAX_QUOTE_LEN = 240;

/** Share-a-quote card: the passage itself, set large, with book title/author
 * attribution below — the shareable-image half of the reading column's
 * "Share quote" action (the plain-text half is copy/native-share, built by
 * ShareButton's `buildShareUrls("quote", …)`). */
function QuoteCard({
  quote,
  title,
  author,
}: {
  quote: string;
  title: string;
  author: string | null;
}) {
  return (
    <Frame>
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: OG_FONT_DISPLAY,
            fontSize: 20,
            color: OG_COLORS.gild,
            marginBottom: 24,
          }}
        >
          “
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: OG_FONT_DISPLAY,
            fontSize: quote.length > 140 ? 38 : 48,
            lineHeight: 1.35,
            color: OG_COLORS.text,
            maxWidth: 920,
          }}
        >
          {truncate(quote, MAX_QUOTE_LEN)}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 36,
            fontSize: 24,
            color: OG_COLORS.ember,
          }}
        >
          {author
            ? `${truncate(title, MAX_TITLE_LEN)} — ${truncate(author, MAX_AUTHOR_LEN)}`
            : truncate(title, MAX_TITLE_LEN)}
        </div>
      </div>
    </Frame>
  );
}

type Params = { params: Promise<{ bookId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { bookId } = await params;
  const url = new URL(req.url);
  const parsedQuery = queryHint.safeParse({
    cast: url.searchParams.get("cast") ?? undefined,
    total: url.searchParams.get("total") ?? undefined,
    days: url.searchParams.get("days") ?? undefined,
    quote: url.searchParams.get("quote") ?? undefined,
  });
  const q = parsedQuery.success ? parsedQuery.data : {};

  let card: React.ReactElement = <FallbackCard />;

  try {
    if (UUID_RE.test(bookId)) {
      await dbReady;
      const book = await getBook(bookId);
      if (book && book.visibility === "published") {
        card = q.quote ? (
          <QuoteCard
            quote={q.quote}
            title={truncate(book.title, MAX_TITLE_LEN)}
            author={book.author ? truncate(book.author, MAX_AUTHOR_LEN) : null}
          />
        ) : (
          <BookCard
            title={truncate(book.title, MAX_TITLE_LEN)}
            author={book.author ? truncate(book.author, MAX_AUTHOR_LEN) : null}
            cast={q.cast}
            total={q.total}
            days={q.days}
          />
        );
      }
    }
  } catch {
    // Any lookup failure (bad id shape slipping past the regex, db hiccup,
    // etc.) must still degrade to the safe generic card, never a 500 that
    // could show a broken-image icon in a social preview or hint at
    // something existing behind the id.
    card = <FallbackCard />;
  }

  return new ImageResponse(card, {
    ...OG_SIZE,
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
