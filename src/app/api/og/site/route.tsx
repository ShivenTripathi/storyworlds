import { ImageResponse } from "next/og";
import { Frame } from "../_lib/Frame";
import { OG_COLORS, OG_FONT_DISPLAY, OG_SIZE } from "../_lib/theme";

/**
 * Public, unauthenticated Open Graph card for the site itself — used as the
 * DEFAULT card on the landing page (`src/app/page.tsx` generateMetadata)
 * whenever a share/visit doesn't resolve to a specific book (no `?book=`,
 * or the book is private/unknown). No params, no DB read: this is a fixed,
 * branded image, so it's cheap to generate and safe for a crawler to hit
 * with zero session context.
 *
 * Kept as its own route rather than overloading /api/og/achievement, whose
 * card hardcodes an "Achievement unlocked" eyebrow that wouldn't make sense
 * as the generic site card.
 */
function SiteCard() {
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
          An illustrated reading companion
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: OG_FONT_DISPLAY,
            fontSize: 64,
            lineHeight: 1.1,
            color: OG_COLORS.text,
            maxWidth: 900,
          }}
        >
          Great books, fully alive.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 20,
            fontSize: 26,
            color: OG_COLORS.muted,
            maxWidth: 800,
          }}
        >
          Read the full text — illustrated, spoiler-safe, and free to start.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 40,
            padding: "8px 20px",
            width: "fit-content",
            borderRadius: 999,
            border: `1px solid ${OG_COLORS.gild}`,
            fontSize: 18,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: OG_COLORS.gild,
          }}
        >
          Free to start
        </div>
      </div>
    </Frame>
  );
}

export async function GET() {
  return new ImageResponse(<SiteCard />, {
    ...OG_SIZE,
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
