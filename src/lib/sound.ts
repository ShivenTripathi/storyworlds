/**
 * Tiny synthesized UI sounds — no audio files, no dependencies, no network.
 * Inspired by the Cuelume approach: short cues generated on the fly with the
 * Web Audio API (oscillators + gain envelopes), so the whole "sound design"
 * is a few hundred bytes of code and stays inside the ZERO-COST constraint.
 *
 * Respectful by default: sound is gated behind a persisted preference and
 * defaults OFF for anyone who has `prefers-reduced-motion` set. The
 * AudioContext is created lazily on the first cue (browsers require a user
 * gesture before audio anyway), so importing this module is inert.
 */

export type Cue =
  | "tick" // light hover / navigation
  | "press" // button down
  | "release" // button up
  | "toggleOn"
  | "toggleOff"
  | "sparkle" // hovering something special (a legendary card)
  | "bloom" // a card / dossier opens — a warm major chord
  | "chime" // a scene / illustration reveals
  | "success"; // achievement unlocked — an ascending flourish

const STORAGE_KEY = "sw-sound";
const MASTER_GAIN = 0.11; // deliberately quiet — these are seasoning, not alerts

let audioCtx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = true; // resolved by initSound(); safe default is silent
let initialized = false;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** Reads the persisted preference; defaults to on, but off under reduced-motion. */
export function initSound(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  muted = saved === null ? prefersReducedMotion() : saved === "muted";
}

export function isMuted(): boolean {
  if (!initialized) initSound();
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next ? "muted" : "on");
  }
  if (!next) playCue("toggleOn");
}

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) {
    audioCtx = new AC();
    master = audioCtx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(audioCtx.destination);
  }
  // Autoplay policy: the context starts suspended until a user gesture.
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

/**
 * Exposes the same lazily-created, gesture-resumed AudioContext to other
 * in-browser audio modules (e.g. `src/lib/soundscape.ts`'s ambient engine) so
 * the app never spins up more than one — browsers cap how many contexts can
 * run concurrently, and the "resume on suspend" dance only needs to live in
 * one place. Callers bring their own GainNode(s) downstream of this; this
 * module's `master` (the quiet one-shot-cue gain) is intentionally not
 * shared, since cues and ambient beds have independent volume/mute controls.
 */
export function getAudioContext(): AudioContext | null {
  return ctx();
}

interface ToneOpts {
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  /** Optional pitch glide target, for a soft "swell". */
  glideTo?: number;
}

function tone(o: ToneOpts): void {
  const ac = audioCtx;
  if (!ac || !master) return;
  const t0 = ac.currentTime + (o.delay ?? 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.glideTo)
    osc.frequency.exponentialRampToValueAtTime(o.glideTo, t0 + o.dur);
  const peak = o.gain ?? 1;
  // Fast attack, exponential decay — the shape that reads as "soft" not "beep".
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
}

// One consonant pitch family (C-major pentatonic) so every cue belongs to the
// SAME soft instrument — the interface has a single quiet voice, not a
// grab-bag of unrelated beeps. Every recipe below uses the default sine
// timbre and the same short envelope; only pitch (and how many notes) varies,
// which is what makes the whole set feel uniform.
const N = {
  G4: 392.0,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5,
};

const RECIPES: Record<Cue, () => void> = {
  // Light single notes for the frequent, incidental cues.
  tick: () => tone({ freq: N.C6, dur: 0.045, gain: 0.3 }),
  press: () => tone({ freq: N.G4, dur: 0.06, gain: 0.5 }),
  release: () => tone({ freq: N.C5, dur: 0.05, gain: 0.34 }),
  // Two-note gestures: rising = on, falling = off (same two pitches).
  toggleOn: () => {
    tone({ freq: N.G4, dur: 0.055, gain: 0.42 });
    tone({ freq: N.C5, dur: 0.07, gain: 0.42, delay: 0.055 });
  },
  toggleOff: () => {
    tone({ freq: N.C5, dur: 0.055, gain: 0.42 });
    tone({ freq: N.G4, dur: 0.07, gain: 0.42, delay: 0.055 });
  },
  // Ascending pentatonic runs of increasing weight for the "reveal" moments.
  sparkle: () => {
    [N.G5, N.A5, N.C6].forEach((f, i) =>
      tone({ freq: f, dur: 0.06, gain: 0.24, delay: i * 0.045 }),
    );
  },
  bloom: () => {
    [N.C5, N.G5].forEach((f, i) =>
      tone({ freq: f, dur: 0.18, gain: 0.34, delay: i * 0.05 }),
    );
  },
  chime: () => {
    [N.E5, N.G5, N.C6].forEach((f, i) =>
      tone({ freq: f, dur: 0.2, gain: 0.28, delay: i * 0.06 }),
    );
  },
  success: () => {
    [N.C5, N.E5, N.G5, N.C6].forEach((f, i) =>
      tone({ freq: f, dur: 0.18, gain: 0.3, delay: i * 0.06 }),
    );
  },
};

/** Plays a cue (no-op when muted, unsupported, or SSR). */
export function playCue(cue: Cue): void {
  if (!initialized) initSound();
  if (muted) return;
  if (!ctx()) return;
  RECIPES[cue]();
}
