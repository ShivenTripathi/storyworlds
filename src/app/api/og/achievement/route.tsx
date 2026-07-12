import { ImageResponse } from "next/og";
import { z } from "zod";
import { dbReady } from "@/db";
import { getBook } from "@/services/books";
import { Frame } from "../_lib/Frame";
import { OG_COLORS, OG_FONT_DISPLAY, OG_SIZE } from "../_lib/theme";

/**
 * Public, unauthenticated Open Graph card for a single milestone/achievement
 * share (e.g. "Full Cast: Dune", "Deep Reader"). Same public-crawler
 * exposure as the book card (see route.tsx there) — everything rendered
 * here is either a fixed, allow-listed achievement "kind" or a short
 * free-text label/detail supplied by the in-app share flow via query
 * params, never a DB lookup of spoiler content.
 *
 * GET /api/og/achievement
 *   ?kind=<achievement kind>   — one of ACHIEVEMENT_KINDS below, selects the
 *                                accent glyph; unknown/missing -> "custom"
 *   ?label=<string, <=60 chars>   — headline, e.g. "Full Cast"
 *   ?detail=<string, <=90 chars>  — subline, e.g. "13 of 13 characters discovered"
 *   ?bookId=<uuid>             — OPTIONAL. Only used to resolve a book TITLE
 *                                to print under the headline. Resolved
 *                                server-side from the DB, not trusted from
 *                                any bookTitle-shaped param, and only shown
 *                                when that book's visibility is
 *                                'published' — a private book's title is
 *                                never attached to an achievement card,
 *                                even though the achievement itself
 *                                (label/detail) is aggregate/non-spoiler by
 *                                construction.
 *
 * `label`/`detail` are spoofable (a crafted URL could say anything within
 * the length limit) — that vandalizes only the one vanity link the crafter
 * shares themselves, per spec. This route never reads per-user or
 * per-entity data, so no real reader's spoiler state can leak through it.
 */

const ACHIEVEMENT_KINDS = [
  "full-cast",
  "deep-reader",
  "streak",
  "finished",
  "first-scene",
  "custom",
] as const;

const querySchema = z.object({
  kind: z.enum(ACHIEVEMENT_KINDS).default("custom"),
  label: z.string().trim().min(1).max(60).default("Achievement unlocked"),
  detail: z.string().trim().max(90).optional(),
  bookId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .optional(),
});

const KIND_GLYPH: Record<(typeof ACHIEVEMENT_KINDS)[number], string> = {
  "full-cast": "★", // star
  "deep-reader": "✦", // sparkle
  streak: "◆", // diamond
  finished: "❦", // ornamental heart-ish flourish
  "first-scene": "■", // square
  custom: "✧",
};

function AchievementCard({
  glyph,
  label,
  detail,
  bookTitle,
}: {
  glyph: string;
  label: string;
  detail?: string;
  bookTitle?: string;
}) {
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
            width: 96,
            height: 96,
            borderRadius: 48,
            border: `2px solid ${OG_COLORS.gild}`,
            alignItems: "center",
            justifyContent: "center",
            fontSize: 44,
            color: OG_COLORS.gild,
            marginBottom: 32,
          }}
        >
          {glyph}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 20,
            letterSpacing: 5,
            textTransform: "uppercase",
            color: OG_COLORS.ember,
            marginBottom: 18,
          }}
        >
          Achievement unlocked
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
          {label}
        </div>

        {detail ? (
          <div
            style={{
              display: "flex",
              marginTop: 18,
              fontSize: 28,
              color: OG_COLORS.muted,
              maxWidth: 860,
            }}
          >
            {detail}
          </div>
        ) : null}

        {bookTitle ? (
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 22,
              color: OG_COLORS.gild,
            }}
          >
            {bookTitle}
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    kind: url.searchParams.get("kind") ?? undefined,
    label: url.searchParams.get("label") ?? undefined,
    detail: url.searchParams.get("detail") ?? undefined,
    bookId: url.searchParams.get("bookId") ?? undefined,
  });

  // Invalid/oversized params still render a card — just fall back to
  // schema defaults — an OG route should never 4xx/5xx for a crawler.
  const q: z.infer<typeof querySchema> = parsed.success
    ? parsed.data
    : { kind: "custom", label: "Achievement unlocked" };

  let bookTitle: string | undefined;
  if (q.bookId) {
    try {
      await dbReady;
      const book = await getBook(q.bookId);
      if (book && book.visibility === "published") {
        bookTitle =
          book.title.length > 70 ? `${book.title.slice(0, 69)}…` : book.title;
      }
    } catch {
      bookTitle = undefined;
    }
  }

  const card = (
    <AchievementCard
      glyph={KIND_GLYPH[q.kind]}
      label={q.label}
      detail={q.detail}
      bookTitle={bookTitle}
    />
  );

  return new ImageResponse(card, {
    ...OG_SIZE,
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
