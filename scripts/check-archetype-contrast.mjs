#!/usr/bin/env node
// Verifies WCAG contrast for every EX LIBRIS world-theme archetype, in both
// the dark "Fireside" default palette and the light "Reading Room" palette.
//
// Checks (per archetype, per mode):
//   1. world-accent   vs mode background  >= 3.0  (UI component threshold)
//   2. world-accent   vs world-surface    >= 3.0  (UI component threshold)
//   3. world-accent-fg vs world-accent    >= 4.5  (text-on-accent threshold)
//
// This script parses src/theme/archetypes.css directly (rather than
// hardcoding archetype hex values) so that drift between the CSS and this
// check is impossible to miss.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(__dirname, "..", "src", "theme", "archetypes.css");
const css = readFileSync(cssPath, "utf8");

// Fixed Layer 2 semantic backgrounds, mirrored from src/app/globals.css.
// (Layer 3 world tokens are always composited over these.)
const MODE_BACKGROUND = {
  dark: "#17130e", // --ink-950 (--background, dark "Fireside" default)
  light: "#fbf7ef", // --parchment-50 (--background, light "Reading Room")
};

const THRESHOLD_UI = 3.0;
const THRESHOLD_TEXT = 4.5;

// ---------------------------------------------------------------------------
// Contrast math (WCAG 2.x relative luminance / contrast ratio)
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }
  const int = parseInt(m[1], 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function channelLuminance(c) {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function contrastRatio(hexA, hexB) {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Parse src/theme/archetypes.css
// ---------------------------------------------------------------------------

// Matches: [data-world-theme="id"] { ...props... }
// and:     [data-app-theme="light"] [data-world-theme="id"] { ...props... }
const blockRe =
  /(?:\[data-app-theme="light"\]\s*)?\[data-world-theme="([a-z0-9-]+)"\](?:\[data-app-theme[^\]]*\])?\s*\{([^}]*)\}/gi;

const CUSTOM_PROP_RE = /--([a-z-]+)\s*:\s*([^;]+);/gi;

function parseProps(block) {
  const props = {};
  let m;
  CUSTOM_PROP_RE.lastIndex = 0;
  while ((m = CUSTOM_PROP_RE.exec(block))) {
    props[m[1].trim()] = m[2].trim();
  }
  return props;
}

/** @type {Record<string, { dark: Record<string,string>, light: Record<string,string> }>} */
const archetypes = {};

let match;
while ((match = blockRe.exec(css))) {
  const [fullMatch, id, body] = match;
  const isLight = fullMatch.startsWith('[data-app-theme="light"]');
  const mode = isLight ? "light" : "dark";
  const props = parseProps(body);

  archetypes[id] ??= { dark: {}, light: {} };
  archetypes[id][mode] = { ...archetypes[id][mode], ...props };
}

const ids = Object.keys(archetypes).sort();

if (ids.length === 0) {
  console.error(
    `No [data-world-theme="..."] blocks found in ${cssPath}. Nothing to check.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Resolve var() references against a small lookup of primitives, in case an
// archetype expresses a token in terms of another CSS variable rather than a
// literal hex value.
// ---------------------------------------------------------------------------

const PRIMITIVES = {
  "parchment-50": "#fbf7ef",
  "parchment-100": "#f6f0e3",
  "parchment-200": "#ede3cf",
  "parchment-300": "#dfd2b8",
  "parchment-400": "#c9b896",
  "parchment-500": "#a99a78",
  "ink-950": "#17130e",
  "ink-900": "#201b14",
  "ink-800": "#2b251c",
  "ink-700": "#3a3226",
  "ink-600": "#4e4536",
  "ink-500": "#6b6150",
  "ink-400": "#8a8070",
  "ink-300": "#aba294",
  "ember-300": "#f2b270",
  "ember-400": "#e39044",
  "ember-500": "#c96f26",
  "ember-600": "#a85517",
  "ember-700": "#874312",
  "ember-800": "#64330f",
  "sage-500": "#6f7d5c",
  "oxblood-500": "#8c3b34",
  "lapis-500": "#3e5c76",
};

function resolve(value) {
  const varMatch = value.match(/^var\(--([a-z0-9-]+)\)$/i);
  if (varMatch) {
    const resolved = PRIMITIVES[varMatch[1]];
    if (!resolved) {
      throw new Error(`Cannot resolve var(--${varMatch[1]}) to a primitive.`);
    }
    return resolved;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Run checks
// ---------------------------------------------------------------------------

const failures = [];
const rows = [];

for (const id of ids) {
  for (const mode of ["dark", "light"]) {
    const tokens = archetypes[id][mode];
    const required = [
      "world-accent",
      "world-accent-fg",
      "world-surface",
    ];
    const missing = required.filter((k) => !tokens[k]);
    if (missing.length > 0) {
      failures.push(
        `${id} (${mode}): missing token(s) ${missing.join(", ")}`,
      );
      continue;
    }

    const accent = resolve(tokens["world-accent"]);
    const accentFg = resolve(tokens["world-accent-fg"]);
    const surface = resolve(tokens["world-surface"]);
    const background = MODE_BACKGROUND[mode];

    const accentVsBg = contrastRatio(accent, background);
    const accentVsSurface = contrastRatio(accent, surface);
    const fgVsAccent = contrastRatio(accentFg, accent);

    const checks = [
      ["accent vs background", accentVsBg, THRESHOLD_UI],
      ["accent vs surface", accentVsSurface, THRESHOLD_UI],
      ["accent-fg vs accent", fgVsAccent, THRESHOLD_TEXT],
    ];

    for (const [label, ratio, threshold] of checks) {
      const pass = ratio >= threshold;
      rows.push({
        id,
        mode,
        label,
        ratio: ratio.toFixed(2),
        threshold: threshold.toFixed(1),
        pass,
      });
      if (!pass) {
        failures.push(
          `${id} (${mode}): ${label} = ${ratio.toFixed(2)}:1, needs >= ${threshold.toFixed(1)}:1`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("EX LIBRIS archetype contrast check FAILED\n");

  const idWidth = Math.max(...rows.map((r) => r.id.length), 8);
  const modeWidth = 5;
  const labelWidth = Math.max(...rows.map((r) => r.label.length), 5);

  const header = `${"archetype".padEnd(idWidth)}  ${"mode".padEnd(modeWidth)}  ${"check".padEnd(labelWidth)}  ratio   threshold  result`;
  console.error(header);
  console.error("-".repeat(header.length));
  for (const r of rows) {
    console.error(
      `${r.id.padEnd(idWidth)}  ${r.mode.padEnd(modeWidth)}  ${r.label.padEnd(labelWidth)}  ${r.ratio.padStart(5)}:1  >= ${r.threshold}:1   ${r.pass ? "PASS" : "FAIL"}`,
    );
  }

  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) {
    console.error(`  - ${f}`);
  }

  process.exit(1);
}

console.log(`Checked ${ids.length} archetypes x 2 modes x 3 checks.`);
console.log("all archetypes pass");
