import { Fraunces, Literata, Instrument_Sans } from "next/font/google";

/**
 * EX LIBRIS type system
 *
 * - `fraunces`  — the voice of the book. Display serif for headings, titles,
 *   and anywhere the identity of Story Worlds should feel handset and warm.
 * - `literata`  — the voice of long-form reading. A text serif tuned for
 *   comfortable reading of book/chapter content.
 * - `instrumentSans` — the voice of the tool. UI chrome, labels, controls.
 */

export const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

export const literata = Literata({
  variable: "--font-reading",
  subsets: ["latin"],
  display: "swap",
});

export const instrumentSans = Instrument_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
  display: "swap",
});
