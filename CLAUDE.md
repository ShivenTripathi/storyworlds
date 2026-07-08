# Story Worlds

"Cursor/Lovable for Literature" — an AI-augmented reading product. Core stance: **never summarize or abridge**; breathe life into the full text (illustrations, world reference, character chat, eventually what-if branches).

## Status: mid-rebuild

The repo is being rebuilt from an Emergent-platform hackathon prototype into a production TypeScript monolith. **`backend/` and `frontend/` are FROZEN LEGACY** (Python/FastAPI + CRA) — never modify them; they exist only as reference until milestone M6 deletes them. The full audit + plan lives at `~/.claude/plans/this-repository-was-started-wiggly-reef.md`.

## Stack (new app, repo root)

- **Next.js 16 App Router + TypeScript**, Tailwind CSS v4 (CSS-first `@theme` — no tailwind.config.js), app in `src/`
- **Drizzle ORM**: PGlite at `.data/pglite` in dev (no DATABASE_URL) / Neon Postgres in prod. One client: `src/db/index.ts`. Schema: `src/db/schema.ts`. Migrations: `npm run db:generate`.
- **Clerk** auth (`@clerk/nextjs` v7 — use `<Show when="signed-in">`, NOT the removed `SignedIn/SignedOut`). Auth checks are resource-based (`await auth.protect()` in protected layouts), NOT route-matcher middleware (deprecated + broken in keyless mode). Keyless dev: on first boot Clerk writes `.clerk/.tmp/keyless.json`; promote those keys into `.env.local` (`node -e` one-liner, see git history) or protected routes 500.
- **Inngest** for the book-analysis pipeline (dev: `npx inngest-cli dev`)
- **LLM**: direct `@anthropic-ai/sdk` + `@google/genai`; model IDs from env (`MODEL_SEGMENT`, `MODEL_SYNTHESIS`, `MODEL_CHAT`, `MODEL_IMAGE`); mock driver when keys absent
- **Storage**: local `.data/` in dev, Cloudflare R2 in prod, behind `src/services/storage.ts`

## Architecture rules

- `src/domain/` = pure logic, imports nothing from `db/` or `ai/`; unit-testable without mocks
- Route handlers are thin: auth → zod-validate → `src/services/*` call
- **Entity IDs are minted in code** (deterministic slugs like `char:paul-atreides`), never by LLMs — LLMs emit names/aliases only, resolved via the alias table (`src/domain/entities/`)
- Every content endpoint requires auth + `requireBookAccess`; no anonymous book/chunk access
- Every LLM call goes through the budget wrapper (`src/ai/budget.ts`) — usage ledger + per-book cap
- Spoiler safety is server-gated by the reader's *frontier* (max chunk reached); spoiler content never reaches the DOM
- Design tokens only — no literal Tailwind colors in components. Per-book theming via `data-world-theme` archetypes (`src/theme/`); run `npm run check:contrast` after touching archetype colors.

## Commands

- `npm run dev` — Next dev server (Turbopack)
- `npm run build` / `npx tsc --noEmit` — build / typecheck
- `npm run db:generate` — Drizzle migration from schema changes
- `npm run check:contrast` — WCAG check on theme archetypes (must pass)
- `npx inngest-cli dev` — local job runner (needed for analysis pipeline)

## Security invariants

- A previous LLM key was leaked into git history here. **Never write any key/secret into a tracked file** (a hook blocks it). Secrets live in `.env` (gitignored); document new vars in `.env.example`.
- All model/provider config via env, never hardcoded.
