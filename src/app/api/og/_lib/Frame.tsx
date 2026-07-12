import { OG_COLORS, OG_FONT_DISPLAY, OG_FONT_UI, OG_SIZE } from "./theme";

/**
 * Shared card chrome for both OG routes (book + achievement): the parchment
 * ground, a gilded double-rule border, corner flourishes, and the "STORY
 * WORLDS" wordmark footer. Plain JSX-returning functions compose fine inside
 * `ImageResponse` (satori walks the resulting element tree — it does not
 * need real React rendering/hooks), so this stays a normal component even
 * though nothing here is client-interactive.
 *
 * NOTE ON FONTS: we deliberately do NOT fetch a custom font (e.g. Fraunces
 * from Google Fonts) for satori to embed. That's the common next/og pattern,
 * but it adds a network fetch on every cold render of a route that public,
 * unauthenticated social-media crawlers hit — a failure or slow response
 * there would break link unfurling. `ImageResponse`/satori falls back to a
 * bundled sans font for any unresolved `fontFamily`, so generic serif/sans
 * stacks below render safely with zero external calls. Revisit if/when we
 * want pixel-perfect Fraunces on cards — it'd need font bytes fetched once
 * and cached, not per-request.
 */
export function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        backgroundColor: OG_COLORS.groundDark,
        backgroundImage: `radial-gradient(circle at 82% 18%, rgba(217,171,85,0.16), rgba(0,0,0,0) 45%)`,
        padding: 40,
        fontFamily: OG_FONT_UI,
        position: "relative",
      }}
    >
      {/* Gilded double-rule border */}
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          border: `2px solid ${OG_COLORS.gild}`,
          borderRadius: 4,
          padding: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            border: `1px solid ${OG_COLORS.ember}`,
            borderRadius: 2,
            padding: 56,
            position: "relative",
          }}
        >
          {children}

          {/* Footer wordmark */}
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: 56,
              right: 56,
              bottom: 40,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: OG_FONT_DISPLAY,
                fontSize: 22,
                letterSpacing: 4,
                color: OG_COLORS.gild,
                textTransform: "uppercase",
              }}
            >
              Story Worlds
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 16,
                letterSpacing: 1,
                color: OG_COLORS.muted,
              }}
            >
              storyworlds.app
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
