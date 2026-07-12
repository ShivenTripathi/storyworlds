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

// C-major-ish frequencies used across the warmer cues.
const C5 = 523.25,
  E5 = 659.25,
  G5 = 783.99,
  C6 = 1046.5;

const RECIPES: Record<Cue, () => void> = {
  tick: () => tone({ freq: 2100, dur: 0.03, type: "triangle", gain: 0.4 }),
  press: () =>
    tone({ freq: 300, dur: 0.06, type: "sine", gain: 0.7, glideTo: 260 }),
  release: () => tone({ freq: 460, dur: 0.05, type: "sine", gain: 0.45 }),
  toggleOn: () => {
    tone({ freq: 440, dur: 0.05, gain: 0.5 });
    tone({ freq: 660, dur: 0.07, gain: 0.5, delay: 0.05 });
  },
  toggleOff: () => {
    tone({ freq: 520, dur: 0.05, gain: 0.5 });
    tone({ freq: 340, dur: 0.07, gain: 0.5, delay: 0.05 });
  },
  sparkle: () => {
    [1320, 1760, 2200].forEach((f, i) =>
      tone({
        freq: f,
        dur: 0.07,
        type: "triangle",
        gain: 0.28,
        delay: i * 0.035,
      }),
    );
  },
  bloom: () => {
    [C5, E5, G5].forEach((f, i) =>
      tone({ freq: f, dur: 0.24, type: "sine", gain: 0.4, delay: i * 0.045 }),
    );
  },
  chime: () => {
    [E5, G5, C6].forEach((f, i) =>
      tone({ freq: f, dur: 0.34, type: "sine", gain: 0.32, delay: i * 0.06 }),
    );
  },
  success: () => {
    [C5, E5, G5, C6].forEach((f, i) =>
      tone({ freq: f, dur: 0.3, type: "sine", gain: 0.34, delay: i * 0.07 }),
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
