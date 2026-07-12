"use client";

import Link from "next/link";
import { useState } from "react";
import type { CodexCardData, CodexCardRevealed, Rarity } from "./types";

interface CodexCardTileProps {
  card: CodexCardData;
  bookId: string;
}

// A small, FIXED palette for rarity — deliberately NOT `--world-accent`
// (that token is re-themed per-book via data-world-theme, so a card's rarity
// color would shift book-to-book and stop reading as a consistent game-state
// signal). These lean on the same warm-neutral primitive families as the
// rest of EX LIBRIS (ink/lapis/oxblood/ember) rather than literal Tailwind
// colors, just pinned instead of semantic.
const RARITY_STYLES: Record<Rarity, { label: string; color: string }> = {
  common: { label: "Common", color: "var(--ink-400)" },
  rare: { label: "Rare", color: "var(--lapis-500)" },
  epic: {
    label: "Epic",
    color: "color-mix(in srgb, var(--lapis-500) 45%, var(--oxblood-500))",
  },
  legendary: { label: "Legendary", color: "var(--ember-400)" },
};

function initial(name: string): string {
  const ch = name.trim().charAt(0);
  return (ch || "?").toUpperCase();
}

/**
 * One Codex grid cell — either a pure silhouette (locked) or a revealed
 * collectible card. Never branch on anything but `card.state`: a locked
 * card's payload literally has no id/name/rarity to render.
 */
export function CodexCardTile({ card, bookId }: CodexCardTileProps) {
  if (card.state === "locked") {
    return <LockedTile />;
  }
  return <RevealedTile card={card} bookId={bookId} />;
}

function LockedTile() {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border p-3"
      style={{ borderColor: "var(--world-frame)", background: "var(--card)" }}
    >
      <div
        aria-hidden="true"
        className="relative grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-md"
        style={{
          background: "linear-gradient(160deg, var(--ink-700), var(--ink-900))",
        }}
      >
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, var(--ink-500) 0, var(--ink-500) 1px, transparent 1px, transparent 8px)",
          }}
        />
        <WaxSealGlyph />
      </div>
      <div className="text-center">
        <p className="font-ui text-xs font-medium text-muted-foreground">
          Undiscovered
        </p>
        <p className="font-ui text-[10px] text-muted-foreground italic">
          Keep reading
        </p>
      </div>
    </div>
  );
}

function RevealedTile({
  card,
  bookId,
}: {
  card: CodexCardRevealed;
  bookId: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const rarity = RARITY_STYLES[card.rarity];
  const isLegendary = card.rarity === "legendary";

  const body = (
    <div
      data-sound-hover={isLegendary ? "sparkle" : undefined}
      className="relative flex flex-col gap-2 overflow-hidden rounded-lg border p-3 transition-colors"
      style={{ borderColor: rarity.color, background: "var(--card)" }}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md">
        {card.portraitUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- dynamic per-entity portrait from DB-backed storage, not a static/optimizable asset */}
            <img
              src={card.portraitUrl}
              alt={`Portrait of ${card.name}`}
              onLoad={() => setLoaded(true)}
              className={`h-full w-full object-cover transition-opacity duration-300 motion-reduce:transition-none ${
                loaded ? "opacity-100" : "opacity-0"
              }`}
            />
            {!loaded ? (
              <div
                aria-hidden="true"
                className="absolute inset-0 animate-pulse motion-reduce:animate-none"
                style={{ background: "var(--muted)" }}
              />
            ) : null}
          </>
        ) : (
          <div
            aria-hidden="true"
            className="grid h-full w-full place-items-center"
            style={{
              background: `linear-gradient(160deg, color-mix(in srgb, ${rarity.color} 25%, var(--world-surface)), var(--world-surface))`,
            }}
          >
            <span
              className="font-display text-4xl leading-none"
              style={{ color: rarity.color }}
            >
              {initial(card.name)}
            </span>
          </div>
        )}

        {isLegendary ? <HolographicSheen /> : null}

        {card.state === "met" ? (
          <span
            aria-hidden="true"
            title="Newly discovered"
            className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full"
            style={{ background: "var(--ember-400)" }}
          />
        ) : null}
      </div>

      <div className="min-w-0">
        <p
          className="truncate font-display text-sm leading-snug text-foreground"
          title={card.name}
        >
          {card.name}
        </p>
        <span
          className="mt-1 inline-block rounded-full px-2 py-0.5 font-ui text-[10px] font-medium tracking-wide uppercase"
          style={{ color: rarity.color, border: `1px solid ${rarity.color}` }}
        >
          {rarity.label}
        </span>
      </div>
    </div>
  );

  if (card.kind === "character") {
    return (
      <Link
        href={`/books/${bookId}/characters/${encodeURIComponent(card.id)}`}
        data-sound="bloom"
        className="block min-h-[44px] rounded-lg focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        {body}
      </Link>
    );
  }

  return body;
}

/**
 * A slow-spinning conic-gradient sweep, clipped to the portrait, giving
 * legendary cards a foil-card sheen. Built from `animate-spin` (Tailwind's
 * built-in keyframe) with the duration slowed via inline style, so no new
 * global CSS/keyframes are needed. `motion-reduce:animate-none` freezes it
 * into a still (but still visibly different) gradient rather than removing
 * the effect outright.
 */
function HolographicSheen() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -inset-1/2 animate-spin opacity-30 mix-blend-overlay motion-reduce:animate-none"
      style={{
        animationDuration: "6s",
        background:
          "conic-gradient(from 0deg, transparent 0deg, var(--ember-300) 60deg, transparent 130deg, var(--lapis-500) 200deg, transparent 260deg, var(--ember-400) 320deg, transparent 360deg)",
      }}
    />
  );
}

function WaxSealGlyph() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 34 34"
      aria-hidden="true"
      className="relative z-10"
    >
      <circle
        cx="17"
        cy="17"
        r="15"
        fill="var(--ember-700)"
        stroke="var(--ember-500)"
        strokeWidth="1.5"
      />
      <text
        x="17"
        y="23"
        textAnchor="middle"
        fontSize="16"
        fontFamily="var(--font-display), serif"
        fill="var(--parchment-100)"
      >
        ?
      </text>
    </svg>
  );
}
