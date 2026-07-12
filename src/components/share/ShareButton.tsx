"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Achievement "kind"s the /api/og/achievement route knows how to draw an
 * accent glyph for. Keep in sync with ACHIEVEMENT_KINDS in
 * src/app/api/og/achievement/route.tsx.
 */
export type AchievementKind =
  | "full-cast"
  | "deep-reader"
  | "streak"
  | "finished"
  | "first-scene"
  | "custom";

type ShareButtonProps =
  | {
      kind: "book";
      /** UUID of a *published* book — private books should not render this button at all (see README). */
      bookId: string;
      title: string;
      author?: string | null;
      /** Aggregate, non-spoiler collection progress — the exact numbers this reader currently sees. */
      castMet?: number;
      castTotal?: number;
      daysReading?: number;
      className?: string;
    }
  | {
      kind: "achievement";
      achievementKind: AchievementKind;
      label: string;
      detail?: string;
      /** Optional: attributes the achievement to a book. Omit for cross-book milestones (e.g. reading streak). */
      bookId?: string;
      className?: string;
    };

function buildUrls(props: ShareButtonProps, origin: string) {
  const params = new URLSearchParams();
  let ogPath: string;
  let shareText: string;
  let destPath: string;

  if (props.kind === "book") {
    if (props.castMet !== undefined)
      params.set("cast", String(Math.max(0, Math.trunc(props.castMet))));
    if (props.castTotal !== undefined)
      params.set("total", String(Math.max(0, Math.trunc(props.castTotal))));
    if (props.daysReading !== undefined)
      params.set("days", String(Math.max(0, Math.trunc(props.daysReading))));
    ogPath = `/api/og/book/${encodeURIComponent(props.bookId)}`;
    shareText = props.author
      ? `I'm reading "${props.title}" by ${props.author} on Story Worlds.`
      : `I'm reading "${props.title}" on Story Worlds.`;
    // Public destination: the marketing landing page funnels a new visitor
    // into sign-up/Discover (there's no unauthenticated book page yet — see
    // README "wiring" note). `ref` is just an attribution query param, not
    // a lookup key.
    destPath = `/?ref=share-book&book=${encodeURIComponent(props.bookId)}`;
  } else {
    params.set("kind", props.achievementKind);
    params.set("label", props.label);
    if (props.detail) params.set("detail", props.detail);
    if (props.bookId) params.set("bookId", props.bookId);
    ogPath = "/api/og/achievement";
    shareText = props.detail
      ? `${props.label} — ${props.detail} (Story Worlds)`
      : `${props.label} — Story Worlds`;
    destPath = props.bookId
      ? `/?ref=share-achievement&book=${encodeURIComponent(props.bookId)}`
      : "/?ref=share-achievement";
  }

  const qs = params.toString();
  return {
    ogImageUrl: `${origin}${ogPath}${qs ? `?${qs}` : ""}`,
    shareUrl: `${origin}${destPath}`,
    shareText,
  };
}

/**
 * Token-clean in-app share trigger. Opens a small sheet with native share
 * (when supported), copy-link, and save-image (linking straight at the
 * public OG route so the reader gets exactly the same card that'll unfurl
 * wherever they paste the link).
 *
 * Uses design tokens throughout (bg-[var(--primary)], etc.) — the hardcoded
 * EX LIBRIS hex values live ONLY in src/app/api/og/_lib/theme.ts, for the
 * generated image itself.
 */
export function ShareButton(props: ShareButtonProps) {
  const { className } = props;
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Origin is only known client-side; avoid a hydration mismatch by reading
  // it after mount rather than during the initial render.
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount hydration (window.location is browser-only), see comment above
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!origin) {
    // Render nothing interactive until we know the origin — keeps this a
    // no-op on the server and avoids building a bogus relative-only URL.
    return null;
  }

  const { ogImageUrl, shareUrl, shareText } = buildUrls(props, origin);
  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function handleNativeShare() {
    try {
      await navigator.share({ title: shareText, url: shareUrl });
      setOpen(false);
    } catch {
      // AbortError (user cancelled) or unsupported — leave the sheet open
      // so copy-link/save-image are still available.
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  }

  return (
    <div className={`relative inline-block ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-4 py-2 font-ui text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        Share
      </button>

      {open ? (
        <>
          {/* Click-outside-to-dismiss backdrop. Decorative/non-interactive
              beyond closing the sheet, so it's a button (keyboard focusable
              would be redundant with Escape) rather than needing its own
              label. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            id={panelId}
            role="dialog"
            aria-label="Share this"
            className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 shadow-lg"
          >
            {canNativeShare ? (
              <button
                type="button"
                onClick={handleNativeShare}
                className="block w-full rounded-md px-3 py-2 text-left font-ui text-sm text-[var(--card-foreground)] hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                Share…
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleCopyLink}
              className="block w-full rounded-md px-3 py-2 text-left font-ui text-sm text-[var(--card-foreground)] hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              {copyState === "copied"
                ? "Copied!"
                : copyState === "error"
                  ? "Couldn't copy — long-press to select"
                  : "Copy link"}
            </button>
            <a
              href={ogImageUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="block w-full rounded-md px-3 py-2 text-left font-ui text-sm text-[var(--card-foreground)] hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              Save image
            </a>
          </div>
        </>
      ) : null}
    </div>
  );
}
