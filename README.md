# Story Worlds

**Great books, fully alive.** An AI-augmented reading product — upload a book, read it whole (never summarized, never abridged), and watch its world surface around you: characters, places, scene illustrations, and conversations with characters who only know what *you* have read so far.

## Features

- **Chunked reader** — Kindle-like page-by-page reading with typography controls (faces, size, measure, four reading themes), keyboard navigation, and progress that syncs across devices.
- **Story Worlds engine** — a background pipeline analyzes the full text into a *world reference*: characters (with aliases resolved deterministically in code, never by an LLM), places, timeline, and a visual style that themes the entire UI per book via 12 hand-set, contrast-vetted archetypes.
- **Scene overlays & illustrations** — every page gets a lazily-generated scene companion; illustrations render inline as engraved chapter plates.
- **Character chat** — temporally honest: in "story so far" mode a character knows only what you've reached (the spoiler frontier is enforced server-side and never reaches the DOM). "After the ending" is earned or explicitly acknowledged.
- **Discover** — published books share their analyzed worlds; adding one costs nothing.
- **Admin press room** — pipeline monitor, per-book LLM spend from the usage ledger, publish/unpublish, archetype override.

## Public API (experimental)

A minimal read-only API authenticated by `sw_live_…` keys instead of a browser session (only a key's sha256 hash is stored; the secret is shown once at mint time). Mint and revoke keys with a signed-in session via `POST /api/me/keys` and `DELETE /api/me/keys/:keyId`; then:

- `GET /api/v1/books` — your books (Bearer auth, 60 req/min per key)
- `GET /api/v1/books/:bookId/world` — a book's analyzed world reference, spoiler-gated to your reading frontier just like the app (`?full=1` opts out, owner only)

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · Drizzle ORM (PGlite in dev, Neon Postgres in prod) · Clerk · Inngest · direct Anthropic/Gemini SDKs with a mock driver for keyless dev.

Designed to run **entirely on card-free free tiers**: Vercel Hobby + Neon + Clerk + Inngest + Google AI Studio (Gemini). Blob storage is DB-backed by default (R2 driver exists when you have a card). Stripe billing is fully wired but dormant behind `BILLING_ENABLED`.

## Development

```bash
npm install
npm run dev              # Next dev server — Clerk keyless, PGlite, mock LLM: zero keys needed
npx inngest-cli dev -u http://localhost:3000/api/inngest   # job runner (analysis pipeline)
```

On first boot Clerk writes keyless credentials to `.clerk/.tmp/keyless.json`; promote them to `.env.local`:

```bash
node -e "const k=require('./.clerk/.tmp/keyless.json');require('fs').writeFileSync('.env.local','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='+k.publishableKey+'\nCLERK_SECRET_KEY='+k.secretKey+'\nINNGEST_DEV=1\n')"
```

All configuration is documented in `.env.example`. Quality gates:

```bash
npx tsc --noEmit         # typecheck
npm test                 # domain unit tests (vitest)
npm run check:contrast   # WCAG gate on theme archetypes
npm run build
```

See `CLAUDE.md` for architecture rules and invariants.
