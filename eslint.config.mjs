import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Guard against stray debug logging; console.warn/error stay allowed
      // for the "log to stderr, then handle/degrade" pattern used throughout
      // ai/, services/, and lib/ (e.g. src/lib/api-keys.ts's fire-and-forget
      // usage touch, src/lib/auth.ts's non-fatal email backfill).
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  // Inngest job handlers deliberately console.log a run summary on each tick
  // (src/jobs/sweep-*.ts, catalog-ingest.ts) — that's the job's
  // observability surface (visible in the Inngest dashboard), not stray
  // debug output, so allow console.log there. Same reasoning for the
  // one-off CLI scripts in scripts/**, whose entire purpose is to print a
  // report to stdout.
  {
    files: ["src/jobs/**/*.ts", "scripts/**/*.mjs"],
    rules: {
      "no-console": ["warn", { allow: ["warn", "error", "log"] }],
    },
  },
  // Strict accessibility for UI code — eslint-config-next ships jsx-a11y at
  // warn; escalate the load-bearing rules to error for components/pages so the
  // lint-on-edit hook blocks a11y regressions (visible-label, valid aria,
  // interactive elements keyboard-reachable, no positive tabindex, etc.).
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    rules: {
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/tabindex-no-positive": "error",
      "jsx-a11y/no-noninteractive-tabindex": "error",
      "jsx-a11y/label-has-associated-control": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
