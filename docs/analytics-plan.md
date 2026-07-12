# Analytics Layer — Spike & Plan

A plan for reading analytics surfaced **outside the reader** (primarily the shelf,
also book-detail and admin), per-book and across-books. Scoped to what our data
can already support, plus the small instrumentation gaps to close.

## What we can already derive (no new data)

We store more than enough to start — everything below is a query away:

| Source table | Signal it unlocks |
|---|---|
| `reading_progress` (userId, bookId, currentChunk, **frontierChunk**, updatedAt) | % complete, furthest point, last-read, pace between updates, active books |
| `chunks` / `books` (totalChunks, totalWords, wordCount) | pages/words read (frontier × avg), book length, time-to-finish estimates |
| `chat_sessions` / `chat_messages` (userId, bookId, entityId, mode, createdAt) | who you talk to, how much, which characters are "popular", per-book chat depth |
| `overlays` / `images` (chunkIdx, activeEntityIds) | scenes unlocked, illustrations seen, **character co-occurrence** (who shares a page) |
| `entities` (introducedAtChunk, kind, attributes) | cast size, character "screen time", first-appearance timeline |
| `world_references` (timeline, visualStyle, themeArchetype) | plot map, genre/archetype distribution across a shelf |
| `usage_events` (bookId, userId, model, tokens, costUsd, operation) | LLM cost per book/user/day, **amortization ratio**, free-tier headroom |
| `books` (visibility, pricingTier, catalogSource, contributedByUserId) | catalog vs private vs contributed mix, contribution funnel |

The **one real gap** is *reading time* (minutes on the page). We can approximate it
from the cadence of `reading_progress` updates (gaps between saves ≤ a cap = active
reading), which is good enough to ship — see Instrumentation below for the precise
version.

## Three tiers

### Tier 1 — Personal reading analytics ("Your Reading" on the shelf)
The reader's own stats. This is the headline ask and the most delightful. A card/tab
on the shelf, plus a per-book strip on book-detail.

**Across books (shelf dashboard):**
- Books started / finished / in-progress; total **pages & words read** (frontier-based).
- **Reading streak** (consecutive days with progress) and a calendar heatmap.
- Time reading (approx) — total, and a time-of-day / day-of-week pattern.
- Worlds explored, **cast met** (distinct characters across all books), scenes seen.
- Most-chatted character; favorite archetype/era (from analyzed `visualStyle`).
- A reading timeline ("your year in books") — shareable, the "Wrapped" moment (ties to Phase 4 social).

**Per book (book-detail + shelf card):**
- Progress ring (currentChunk/total) + furthest chapter, est. time-to-finish at your pace.
- Characters you've met vs. ahead (frontier-gated), scenes unlocked, chats had.
- "Picked back up after N days" nudges; resume CTA.

Privacy: strictly the caller's own rows (same per-user scoping the app already enforces).

### Tier 2 — Story-world insights (unique to this product)
Data views *into the book*, powered by the world reference. Nobody else can do this —
it's the differentiator. Surfaced on book-detail (and a future `/books/[id]/insights`),
**always frontier-gated** so it never spoils.

- **Character network graph** — edges from `overlays.activeEntityIds` co-occurrence
  (who appears together). Filtered to your frontier. Reveals the social structure of the story.
- **Character "screen time"** — how many pages each character is active on; a ranked bar.
- **Plot/timeline map** — `world_references.timeline` anchors on a spine, your position marked,
  future events shown only as unlabeled ticks ("7 events ahead").
- **Place map / setting chips**, **thematic arc**, **first-appearance timeline** of the cast.
- **Your questions** — the questions you asked each character, as a personal annotation layer.

These reuse the existing frontier machinery (`frontierFilter`, the world DTO), so they're
spoiler-safe by construction.

### Tier 3 — Product & cost analytics (admin "Press Room", cross-user aggregate)
Some of this already exists in the admin overview; formalize it into a dashboard.

- **Engagement**: DAU/WAU, books opened, median completion %, chat volume, D1/D7 retention cohorts.
- **Catalog performance**: most-read / most-added catalog books; ingestion queue health.
- **Cost & amortization**: LLM spend per book/day from `usage_events`; **amortization ratio**
  (readers per analyzed book — the core unit economic); free-tier quota burn-down (RPD/RPM headroom).
- **Contribution funnel** (when uploads grow): upload → contribute-public vs keep-private rates.
- **Conversion** (when billing on): private-premium demand, plan mix — the `usage_events` +
  `subscriptions` tables already carry the signal.

All aggregate and admin-gated; no per-user data leaves the admin view.

## Instrumentation to add (small, zero-cost)

1. **Reading sessions / time-on-page.** Add a lightweight `reading_events` table
   (userId, bookId, chunkIdx, ts, kind: 'open'|'page'|'close') OR — cheaper — piggyback on
   the existing debounced progress PUT + the new `pagehide` flush to also send a coarse
   `dwellMs`. Approximate session time = sum of consecutive-update gaps capped at ~5 min.
   Start with the approximation (needs *no* new writes), add the events table only if we
   want precise dwell/heatmaps.
2. **Derived rollups.** A nightly (Inngest cron) job materializes per-user and per-book
   rollups into a `reading_stats` table so the shelf dashboard is one indexed read, not a
   fan-out of aggregations. Not needed at current scale; add when the shelf query gets heavy.
3. **Product metrics (optional).** Vercel Web Analytics (free on Hobby, privacy-friendly,
   no cookies) for pageviews/CWV, or PostHog free tier for funnels — only if we want
   client-side product analytics beyond what Postgres gives. Everything above is
   Postgres-only and card-free; keep it that way unless a real need appears.

## Architecture

- `src/services/analytics.ts` — pure-ish query functions (`getReaderStats(userId)`,
  `getBookStats(userId, bookId)`, `getStoryInsights(bookId, frontier)`, `getAdminMetrics()`),
  each a small set of aggregate SQL queries. Frontier-gated ones reuse `getWorldForReader`'s
  filtering.
- `src/app/api/me/stats` + `src/app/api/books/[id]/insights` (frontier-gated) +
  `src/app/api/admin/metrics` (admin). Thin route handlers.
- Charts: follow the `dataviz` skill's palette/rules; render with lightweight inline
  SVG/Canvas (no heavy chart dep) to stay bundle-light. Numbers use tabular-nums; encode
  state with the semantic tokens.
- UI: a "Reading" tab on the shelf (Tier 1), an insights section on book-detail (Tier 2),
  and an admin metrics view (Tier 3). All EX LIBRIS token-clean.

## Suggested sequencing (cheap → deep)

1. **Tier 1 shelf dashboard from existing data** — progress, streak, pages read, cast met,
   most-chatted. Pure queries, no instrumentation, no schema. Highest delight-per-effort.
2. **Tier 2 story insights** — character network + screen-time + timeline on book-detail
   (frontier-gated). The differentiator; reuses world data.
3. **Reading-time approximation** from progress cadence → time stats + heatmap.
4. **Admin metrics dashboard** — formalize cost/amortization/engagement in the Press Room.
5. **Rollup table + (optional) precise reading_events** — only when scale demands it.
6. **"Your Year in Books" shareable** — folds into the Phase 4 social layer.

Nothing here needs a card or a new vendor; it's all derivable from Postgres today, with one
optional lightweight events table if we want precise dwell-time.
