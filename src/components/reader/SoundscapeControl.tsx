"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isSoundscapePlaying,
  loadSoundscapePrefs,
  setSoundscapeVolume,
  SOUNDSCAPE_MOODS,
  startSoundscape,
  stopSoundscape,
  suggestMoodForArchetype,
  type SoundscapeMood,
} from "@/lib/soundscape";

interface SoundscapeControlProps {
  /** The book's `themeArchetype` (e.g. "gothic", "pastoral") — used only to
   * pre-select a suggested mood; never to start playback. */
  bookArchetype?: string | null;
  className?: string;
}

/**
 * A tasteful control for the reader's optional ambient soundscape: a
 * play/pause toggle, a mood selector (defaulting to the book's suggested
 * mood), and a volume slider. Entirely separate from `SoundToggle` (which
 * mutes/unmutes momentary UI click cues) — a reader can want ambience
 * without clicks, or vice versa, so the two never share state.
 *
 * Off by default and never autoplays: the persisted mood/volume preference
 * pre-selects the panel, but starting audio always requires this control's
 * own play button (see src/lib/soundscape.ts for why).
 */
export function SoundscapeControl({
  bookArchetype,
  className,
}: SoundscapeControlProps) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [mood, setMood] = useState<SoundscapeMood>(() =>
    suggestMoodForArchetype(bookArchetype),
  );
  const [volume, setVolume] = useState(0.5);
  const rootRef = useRef<HTMLDivElement>(null);

  // Hydrate the persisted mood/volume after mount — localStorage isn't
  // available during SSR, same post-mount convention used elsewhere in the
  // reader (ReaderSettings, WorldRail's rail width). Deliberately does NOT
  // resume playback even if a previous session left the soundscape "on" —
  // starting audio is always an explicit click on the play button below.
  useEffect(() => {
    const prefs = loadSoundscapePrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMood(prefs.mood);

    setVolume(prefs.volume);
    // Only the very first hydration should fall back to the book's
    // suggested mood (when there's no stored preference yet); re-running
    // this on every bookArchetype change would stomp a reader's explicit
    // choice when they open a different book.
  }, []);

  // Close on outside click / Escape — same pattern as ReaderSettings.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Guarantee clean teardown: stop the ambient bed whenever this control
  // unmounts (leaving the reader — Shelf link, route change, etc). Fades
  // out and then stops every oscillator/buffer source; nothing is left
  // playing in the background.
  useEffect(() => {
    return () => {
      stopSoundscape();
    };
  }, []);

  const togglePlay = useCallback(() => {
    if (isSoundscapePlaying()) {
      stopSoundscape();
      setPlaying(false);
    } else {
      startSoundscape(mood);
      setPlaying(true);
    }
  }, [mood]);

  const selectMood = useCallback((next: SoundscapeMood) => {
    setMood(next);
    if (isSoundscapePlaying()) {
      startSoundscape(next); // crossfades smoothly — see soundscape.ts
    }
  }, []);

  const changeVolume = useCallback((next: number) => {
    setVolume(next);
    setSoundscapeVolume(next);
  }, []);

  const currentMoodLabel =
    SOUNDSCAPE_MOODS.find((m) => m.id === mood)?.label ?? mood;

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        aria-label={
          playing
            ? `Reading soundscape: ${currentMoodLabel}, playing`
            : "Reading soundscape, off"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 min-w-11 items-center justify-center rounded-full border px-3 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        style={{
          background: "var(--card)",
          borderColor: playing ? "var(--world-accent)" : "var(--border)",
          color: playing ? "var(--world-accent)" : "var(--card-foreground)",
        }}
      >
        <SoundscapeGlyph active={playing} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Reading soundscape"
          className="absolute top-full right-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border p-4 shadow-xl"
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
            color: "var(--card-foreground)",
          }}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">Reading soundscape</p>
                <p className="mt-0.5 truncate font-ui text-xs opacity-70">
                  {playing ? `Playing — ${currentMoodLabel}` : "Off"}
                </p>
              </div>
              <button
                type="button"
                onClick={togglePlay}
                aria-pressed={playing}
                aria-label={
                  playing
                    ? "Pause reading soundscape"
                    : "Play reading soundscape"
                }
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                style={{
                  borderColor: playing
                    ? "var(--world-accent)"
                    : "var(--border)",
                  color: playing ? "var(--world-accent)" : "inherit",
                }}
              >
                {playing ? <PauseGlyph /> : <PlayGlyph />}
              </button>
            </div>

            <section>
              <p className="eyebrow mb-2">Mood</p>
              <div className="grid grid-cols-2 gap-2">
                {SOUNDSCAPE_MOODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={mood === m.id}
                    title={m.description}
                    onClick={() => selectMood(m.id)}
                    className="min-h-11 rounded-md border px-2 py-2 font-ui text-xs focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                    style={{
                      borderColor:
                        mood === m.id ? "var(--world-accent)" : "var(--border)",
                      color: mood === m.id ? "var(--world-accent)" : "inherit",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <label htmlFor="soundscape-volume" className="eyebrow mb-2 block">
                Volume
              </label>
              <input
                id="soundscape-volume"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="h-11 w-full cursor-pointer"
                style={{ accentColor: "var(--world-accent)" }}
              />
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SoundscapeGlyph({ active }: { active: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 13c1.5-4 3-6 4.5-2s3 6 4.5 0 3-8 4.5-2 3 6 4.5 2" />
      {active ? null : <line x1="3" y1="20" x2="21" y2="4" opacity="0.6" />}
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4 2.5v11l9-5.5-9-5.5z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="3.5" y="2.5" width="3" height="11" />
      <rect x="9.5" y="2.5" width="3" height="11" />
    </svg>
  );
}
