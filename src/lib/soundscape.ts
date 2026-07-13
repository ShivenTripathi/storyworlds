/**
 * Optional ambient READING SOUNDSCAPES — a looping, very-quiet background
 * texture (a drone/pad, filtered noise, or both) whose mood is suggested by
 * the book being read. Entirely synthesized in-browser with the Web Audio
 * API: oscillators, biquad filters, and generated noise buffers. No audio
 * files, no CDN, no streaming service — this stays inside the ZERO-COST
 * constraint the same way `src/lib/sound.ts`'s one-shot UI cues do.
 *
 * Deliberately a separate engine from sound.ts's cues: different purpose
 * (continuous ambience vs. momentary feedback), different lifetime (starts
 * and stops with the reader, not "for the life of the tab"), and an
 * independent volume/on-off so a reader can want one without the other. The
 * two engines do share the one lazily-created AudioContext, via
 * `getAudioContext()` from sound.ts, so the app never opens more than one.
 *
 * Autoplay policy: starting the soundscape is always an explicit user
 * action (a click on the reader's play/pause control) — this module never
 * calls `startSoundscape` on its own, and the persisted "on" preference
 * (see `loadSoundscapePrefs`) is round-tripped for completeness but is
 * never used to resume playback automatically on load, in keeping with
 * "never autoplay" and `prefers-reduced-motion` defaulting to off.
 */

import { ensureAudioRunning, getAudioContext } from "./sound";

export type SoundscapeMood =
  "hearth" | "rain" | "moor" | "candlelit" | "deepspace" | "pastoral";

export const SOUNDSCAPE_MOODS: {
  id: SoundscapeMood;
  label: string;
  description: string;
}[] = [
  {
    id: "hearth",
    label: "Hearth",
    description: "A warm low pad, like a fire settling in the next room.",
  },
  {
    id: "rain",
    label: "Rain",
    description: "Filtered rain against the glass, with the odd drip.",
  },
  {
    id: "moor",
    label: "Windswept moor",
    description: "Airy wind over open ground and a distant, low drone.",
  },
  {
    id: "candlelit",
    label: "Candlelit",
    description: "A soft pad with a faint, high shimmer.",
  },
  {
    id: "deepspace",
    label: "Deep space",
    description: "Slow, detuned pads drifting past each other.",
  },
  {
    id: "pastoral",
    label: "Pastoral",
    description: "Gentle air and birdsong-like chirps in a quiet field.",
  },
];

const DEFAULT_MOOD: SoundscapeMood = "hearth";

/** Suggests a mood for a book's `themeArchetype` — used to pre-select the
 * mood selector, never to auto-start playback. Falls back to "hearth" for
 * an unrecognized or missing archetype. */
const ARCHETYPE_MOODS: Partial<Record<string, SoundscapeMood>> = {
  classic: "hearth",
  gothic: "candlelit",
  noir: "rain",
  regency: "hearth",
  "golden-age-scifi": "deepspace",
  "desert-epic": "moor",
  mythic: "hearth",
  maritime: "rain",
  pastoral: "pastoral",
  "jazz-age": "candlelit",
  "cosmic-weird": "deepspace",
  "fairy-tale": "candlelit",
};

export function suggestMoodForArchetype(
  archetype?: string | null,
): SoundscapeMood {
  if (archetype && archetype in ARCHETYPE_MOODS) {
    return ARCHETYPE_MOODS[archetype] ?? DEFAULT_MOOD;
  }
  return DEFAULT_MOOD;
}

// ---------------------------------------------------------------------------
// Persisted preference (on/off + mood + volume)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "sw-soundscape";
const DEFAULT_VOLUME = 0.5;

export interface SoundscapePrefs {
  on: boolean;
  mood: SoundscapeMood;
  volume: number;
}

let volume = DEFAULT_VOLUME;

function isMood(value: unknown): value is SoundscapeMood {
  return SOUNDSCAPE_MOODS.some((m) => m.id === value);
}

/** Reads the persisted preference (safe to call from SSR — returns the
 * default). Also primes this module's in-memory volume so a subsequent
 * `setSoundscapeVolume` call without an explicit read still has the right
 * baseline. */
export function loadSoundscapePrefs(): SoundscapePrefs {
  const fallback: SoundscapePrefs = {
    on: false,
    mood: DEFAULT_MOOD,
    volume: DEFAULT_VOLUME,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SoundscapePrefs>;
    const mood = isMood(parsed.mood) ? parsed.mood : fallback.mood;
    const vol =
      typeof parsed.volume === "number" &&
      parsed.volume >= 0 &&
      parsed.volume <= 1
        ? parsed.volume
        : fallback.volume;
    volume = vol;
    return { on: parsed.on === true, mood, volume: vol };
  } catch {
    return fallback;
  }
}

function persist(next: Partial<SoundscapePrefs>): void {
  if (typeof window === "undefined") return;
  try {
    const merged: SoundscapePrefs = {
      on: active != null,
      mood: active?.mood ?? DEFAULT_MOOD,
      volume,
      ...next,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // best-effort — the preference just won't persist across sessions
  }
}

// ---------------------------------------------------------------------------
// Engine plumbing
// ---------------------------------------------------------------------------

const MAX_GAIN = 0.16; // firmly in the background, seasoning not sound design
const FADE_SECONDS = 1.6; // smooth start/stop/crossfade — no clicks or pops

function volumeToGain(v: number): number {
  return Math.min(1, Math.max(0, v)) * MAX_GAIN;
}

/** Ramps an AudioParam smoothly — every gain change in this module goes
 * through this, so nothing ever steps and pops. */
function rampGain(
  param: AudioParam,
  target: number,
  ac: AudioContext,
  seconds: number,
): void {
  const now = ac.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + seconds);
}

function safeStop(node: OscillatorNode | AudioBufferSourceNode): void {
  try {
    node.stop();
  } catch {
    // already stopped — fine
  }
  try {
    node.disconnect();
  } catch {
    // already disconnected — fine
  }
}

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // already disconnected — fine
  }
}

interface MoodHandle {
  /** Stops every oscillator/buffer source and clears any scheduling
   * timers for this mood's graph. Idempotent. */
  stop: () => void;
}

// -- Generated noise buffers, cached per AudioContext (there's only ever one) --

const noiseBufferCache = new WeakMap<
  AudioContext,
  { white: AudioBuffer; pink: AudioBuffer }
>();

function getNoiseBuffers(ac: AudioContext): {
  white: AudioBuffer;
  pink: AudioBuffer;
} {
  const cached = noiseBufferCache.get(ac);
  if (cached) return cached;

  const seconds = 4;
  const length = Math.floor(ac.sampleRate * seconds);

  const white = ac.createBuffer(1, length, ac.sampleRate);
  const whiteData = white.getChannelData(0);
  for (let i = 0; i < length; i++) whiteData[i] = Math.random() * 2 - 1;

  // Paul Kellet's refined pink-noise filter — sounds far softer/warmer than
  // white noise, which is what reads as "rain" or "breeze" rather than static.
  const pink = ac.createBuffer(1, length, ac.sampleRate);
  const pinkData = pink.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    pinkData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }

  const result = { white, pink };
  noiseBufferCache.set(ac, result);
  return result;
}

function createNoiseSource(
  ac: AudioContext,
  type: "white" | "pink",
): AudioBufferSourceNode {
  const buffers = getNoiseBuffers(ac);
  const src = ac.createBufferSource();
  src.buffer = type === "pink" ? buffers.pink : buffers.white;
  src.loop = true;
  return src;
}

// -- Mood builders — each wires a small synth graph into `dest` and returns
// a teardown. Every source starts silent-into-ramp (via the shared mood gain
// in startSoundscape), so nothing here needs its own fade-in. --

function buildHearth(ac: AudioContext, dest: AudioNode): MoodHandle {
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 500;
  filter.Q.value = 0.3;

  const lfo = ac.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.06;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 90;
  lfo.connect(lfoGain).connect(filter.frequency);

  const osc1 = ac.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 65.41; // C2
  const g1 = ac.createGain();
  g1.gain.value = 0.55;

  const osc2 = ac.createOscillator();
  osc2.type = "triangle";
  osc2.frequency.value = 130.81; // C3
  const g2 = ac.createGain();
  g2.gain.value = 0.22;

  osc1.connect(g1).connect(filter);
  osc2.connect(g2).connect(filter);
  filter.connect(dest);

  osc1.start();
  osc2.start();
  lfo.start();

  return {
    stop: () => {
      safeStop(osc1);
      safeStop(osc2);
      safeStop(lfo);
      safeDisconnect(g1);
      safeDisconnect(g2);
      safeDisconnect(lfoGain);
      safeDisconnect(filter);
    },
  };
}

function buildRain(ac: AudioContext, dest: AudioNode): MoodHandle {
  const noiseSrc = createNoiseSource(ac, "pink");
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  filter.Q.value = 0.6;
  const noiseGain = ac.createGain();
  noiseGain.gain.value = 0.8;
  noiseSrc.connect(filter).connect(noiseGain).connect(dest);
  noiseSrc.start();

  let stopped = false;
  let dripTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleDrip() {
    const delay = 1200 + Math.random() * 2600;
    dripTimer = setTimeout(() => {
      if (stopped) return;
      const t0 = ac.currentTime;
      const freq = 900 + Math.random() * 500;
      const osc = ac.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t0 + 0.25);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      osc.connect(g).connect(dest);
      osc.start(t0);
      osc.stop(t0 + 0.35);
      scheduleDrip();
    }, delay);
  }
  scheduleDrip();

  return {
    stop: () => {
      stopped = true;
      if (dripTimer) clearTimeout(dripTimer);
      safeStop(noiseSrc);
      safeDisconnect(filter);
      safeDisconnect(noiseGain);
    },
  };
}

function buildMoor(ac: AudioContext, dest: AudioNode): MoodHandle {
  const noiseSrc = createNoiseSource(ac, "white");
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 700;
  filter.Q.value = 0.5;
  const noiseGain = ac.createGain();
  noiseGain.gain.value = 0.5;

  const lfo = ac.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.045;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 350; // gust sweep depth
  lfo.connect(lfoGain).connect(filter.frequency);

  noiseSrc.connect(filter).connect(noiseGain).connect(dest);

  const drone = ac.createOscillator();
  drone.type = "sine";
  drone.frequency.value = 55; // A1 — a distant low drone under the wind
  const droneGain = ac.createGain();
  droneGain.gain.value = 0.3;
  drone.connect(droneGain).connect(dest);

  noiseSrc.start();
  lfo.start();
  drone.start();

  return {
    stop: () => {
      safeStop(noiseSrc);
      safeStop(lfo);
      safeStop(drone);
      safeDisconnect(filter);
      safeDisconnect(noiseGain);
      safeDisconnect(lfoGain);
      safeDisconnect(droneGain);
    },
  };
}

function buildCandlelit(ac: AudioContext, dest: AudioNode): MoodHandle {
  const osc1 = ac.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 196; // G3
  const g1 = ac.createGain();
  g1.gain.value = 0.28;

  const osc2 = ac.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = 246.94; // B3 — a soft major third above
  const g2 = ac.createGain();
  g2.gain.value = 0.16;

  osc1.connect(g1).connect(dest);
  osc2.connect(g2).connect(dest);

  // Faint high shimmer — very quiet high-passed noise, steady rather than
  // pulsed, to keep the graph (and the risk of audible artifacts) small.
  const shimmerSrc = createNoiseSource(ac, "white");
  const shimmerFilter = ac.createBiquadFilter();
  shimmerFilter.type = "highpass";
  shimmerFilter.frequency.value = 6000;
  const shimmerGain = ac.createGain();
  shimmerGain.gain.value = 0.045;
  shimmerSrc.connect(shimmerFilter).connect(shimmerGain).connect(dest);

  osc1.start();
  osc2.start();
  shimmerSrc.start();

  return {
    stop: () => {
      safeStop(osc1);
      safeStop(osc2);
      safeStop(shimmerSrc);
      safeDisconnect(g1);
      safeDisconnect(g2);
      safeDisconnect(shimmerFilter);
      safeDisconnect(shimmerGain);
    },
  };
}

function buildDeepSpace(ac: AudioContext, dest: AudioNode): MoodHandle {
  // Two detuned pairs, roughly a fifth apart, so the beating between the
  // pairs reads as slow drift rather than a fixed chord.
  const freqs = [110, 110.6, 164.5, 165.3];
  const oscs: OscillatorNode[] = [];
  const gains: GainNode[] = [];

  const panner = ac.createStereoPanner();
  panner.connect(dest);

  const lfo = ac.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.03;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 0.7;
  lfo.connect(lfoGain).connect(panner.pan);

  for (const f of freqs) {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    const g = ac.createGain();
    g.gain.value = 0.13;
    osc.connect(g).connect(panner);
    oscs.push(osc);
    gains.push(g);
  }

  oscs.forEach((o) => o.start());
  lfo.start();

  return {
    stop: () => {
      oscs.forEach(safeStop);
      safeStop(lfo);
      gains.forEach(safeDisconnect);
      safeDisconnect(lfoGain);
      safeDisconnect(panner);
    },
  };
}

function buildPastoral(ac: AudioContext, dest: AudioNode): MoodHandle {
  const noiseSrc = createNoiseSource(ac, "pink");
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1000;
  filter.Q.value = 0.4;
  const noiseGain = ac.createGain();
  noiseGain.gain.value = 0.35;
  noiseSrc.connect(filter).connect(noiseGain).connect(dest);
  noiseSrc.start();

  let stopped = false;
  let chirpTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleChirp() {
    const delay = 2500 + Math.random() * 4500;
    chirpTimer = setTimeout(() => {
      if (stopped) return;
      const t0 = ac.currentTime;
      const base = 2200 + Math.random() * 1400;
      const osc = ac.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(base, t0);
      osc.frequency.exponentialRampToValueAtTime(base * 1.3, t0 + 0.06);
      osc.frequency.exponentialRampToValueAtTime(base * 0.9, t0 + 0.14);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.045, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      osc.connect(g).connect(dest);
      osc.start(t0);
      osc.stop(t0 + 0.2);
      scheduleChirp();
    }, delay);
  }
  scheduleChirp();

  return {
    stop: () => {
      stopped = true;
      if (chirpTimer) clearTimeout(chirpTimer);
      safeStop(noiseSrc);
      safeDisconnect(filter);
      safeDisconnect(noiseGain);
    },
  };
}

const MOOD_BUILDERS: Record<
  SoundscapeMood,
  (ac: AudioContext, dest: AudioNode) => MoodHandle
> = {
  hearth: buildHearth,
  rain: buildRain,
  moor: buildMoor,
  candlelit: buildCandlelit,
  deepspace: buildDeepSpace,
  pastoral: buildPastoral,
};

// ---------------------------------------------------------------------------
// Public engine API
// ---------------------------------------------------------------------------

interface ActiveMood {
  mood: SoundscapeMood;
  gain: GainNode;
  handle: MoodHandle;
  /** Set while fading out toward a stop/teardown — lets isSoundscapePlaying()
   * report "off" as soon as a stop is requested, not just once torn down. */
  stopping: boolean;
}

let master: GainNode | null = null;
let active: ActiveMood | null = null;

function ensureMaster(ac: AudioContext): GainNode {
  if (!master) {
    master = ac.createGain();
    master.gain.value = volumeToGain(volume);
    master.connect(ac.destination);
  }
  return master;
}

/** Starts (or crossfades to) a mood. Safe to call while another mood is
 * already playing — the old graph fades out and tears down while the new
 * one fades in, so mood changes never click or pop.
 *
 * Requires a prior user gesture to actually produce sound (the underlying
 * AudioContext is gesture-gated — see sound.ts), and on the very first call
 * of a session that context is typically still `suspended` (iOS Safari, in
 * particular, only flips it to `running` asynchronously after `resume()`).
 * Building the synth graph and ramping gains against a still-frozen
 * `currentTime` in that window schedules everything in what's effectively
 * the past once the context does start running — the same silent-drop
 * gotcha `sound.ts`'s `playCue` guards against — so this waits for
 * `ensureAudioRunning()` before touching the graph. That resolves
 * synchronously (no visible delay) once a context is already running, which
 * is the common case for every mood change after the first. */
export function startSoundscape(mood: SoundscapeMood): void {
  const ac = getAudioContext();
  if (!ac) return;
  if (ac.state === "running") {
    beginSoundscape(mood, ac);
    return;
  }
  void ensureAudioRunning().then((running) => {
    if (running) beginSoundscape(mood, running);
  });
}

function beginSoundscape(mood: SoundscapeMood, ac: AudioContext): void {
  const m = ensureMaster(ac);

  if (active && active.mood === mood) {
    active.stopping = false;
    rampGain(active.gain.gain, 1, ac, FADE_SECONDS);
    persist({ on: true, mood });
    return;
  }

  const previous = active;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, ac.currentTime);
  gain.connect(m);
  const handle = MOOD_BUILDERS[mood](ac, gain);
  rampGain(gain.gain, 1, ac, FADE_SECONDS);
  active = { mood, gain, handle, stopping: false };

  if (previous) {
    rampGain(previous.gain.gain, 0, ac, FADE_SECONDS);
    setTimeout(
      () => {
        previous.handle.stop();
        safeDisconnect(previous.gain);
      },
      FADE_SECONDS * 1000 + 50,
    );
  }

  persist({ on: true, mood });
}

/** Fades the current mood out and tears down its synth graph. No-op if
 * nothing is playing. Always safe to call on unmount — never leaves
 * oscillators or buffer sources running. */
export function stopSoundscape(): void {
  const ac = getAudioContext();
  const current = active;
  if (!ac || !current) {
    persist({ on: false });
    return;
  }
  current.stopping = true;
  rampGain(current.gain.gain, 0, ac, FADE_SECONDS);
  setTimeout(
    () => {
      current.handle.stop();
      safeDisconnect(current.gain);
      if (active === current) active = null;
    },
    FADE_SECONDS * 1000 + 50,
  );
  persist({ on: false, mood: current.mood });
}

/** Sets the overall ambient volume (0..1), ramped smoothly, and persists it.
 * Safe to call whether or not anything is currently playing. */
export function setSoundscapeVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  const ac = getAudioContext();
  if (ac && master) {
    rampGain(master.gain, volumeToGain(volume), ac, 0.15);
  }
  persist({ volume });
}

/** True once a mood has started fading in, false once a stop has been
 * requested (even mid fade-out) — matches what a play/pause toggle should
 * show. */
export function isSoundscapePlaying(): boolean {
  return active != null && !active.stopping;
}
