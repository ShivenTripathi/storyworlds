# Kindle feature-parity plan for the Story Worlds reader

Research + planning only — no code changed. Goal: inventory what Kindle (and
modern e-readers generally) do to make reading better, compare against our
actual reader code, and lay out a **zero-cost-constraint-safe** roadmap so
switching from Kindle is a no-brainer.

Audited: `src/components/reader/{Reader,WorldRail,ChapterPlate,ReaderSettings,settings,useOverlay}.tsx/.ts`,
`src/domain/{reader-format,codex,schemas}.ts`, `src/services/{world,books}.ts`,
`src/db/schema.ts`, `src/app/(app)/books/[bookId]/read/page.tsx`,
`src/app/(app)/discoveries/`, `src/lib/sound.ts`.

---

## 1. Feature inventory

| Feature | Kindle | Story Worlds today | Notes |
|---|---|---|---|
| Tap-a-word dictionary lookup | Yes, offline (New Oxford + on-device dict file) | **Missing** | No selection handling at all in `Reader.tsx` — text is plain `<p>`/`<span>` runs, no tap/select affordance |
| Wikipedia lookup on selection | Yes ("Smart Lookup") | **Missing** | — |
| Translation on selection | Yes, many languages | **Missing** | No free-tier API of comparable quality exists — **flag: needs a paid/card API** |
| In-book full-text search | Yes | **Missing** | No search endpoint; `chunks.text` has no index |
| Highlights (multi-color) | Yes, several colors | **Missing** | No `highlights` table in schema |
| Notes/annotations on text | Yes | **Missing** | No table |
| Export highlights/notes | Yes (Amazon Notebook, My Clippings.txt, 3rd-party tools) | **Missing** | N/A until highlights exist |
| Bookmarks | Yes, manual, multiple/book | **Missing** | Only an automatic `currentChunk`/`frontierChunk` marker (`reading_progress` table) — no manual saved spots |
| Table of contents / chapter nav | Yes, tap to jump | **Partial** | `reader-format.ts` already *detects* chapter headings and even inline run-together TOCs, but renders them as inert text — no jump menu |
| "Go to page/location" | Yes | **Partial** | `navigate(idx)` already exists internally (used by `?chunk=` deep-links); no UI input for the reader to type a page number |
| Jump-back after following a link | Yes | **Partial** | In-rail Scene/Cast/Chat tabs never navigate away, so mostly moot; but `/discoveries` and future dossier links are real route changes with no "back to my page" affordance |
| X-Ray (people/places/terms) | Yes, static, offline | **Have (and then some)** | `src/services/world.ts` `getWorldForReader` + `getDossier` + the Codex (`src/domain/codex.ts`, `/discoveries`) — AI-generated, frontier-gated, relationships, appearances sparkline, portraits, gamified rarity. Richer than Kindle's static X-Ray file |
| Reading progress (% / page) | Yes | **Have** | `pageLabel` shows "Page N of Total · X%"; frontier tracked server-side |
| "Time left in chapter/book" | Yes, uses measured reading speed | **Missing** | No reading-speed measurement anywhere |
| Location vs. real page number | Kindle tracks both | **Have (chunk-as-page)** | Our chunk *is* the page unit; good enough, no separate concept needed |
| Font family | Yes, several + custom fonts | **Have** | 5 faces in `settings.ts` (Literata, Source Serif 4, Atkinson Hyperlegible, Georgia, OpenDyslexic) |
| Font size | Yes | **Have** | 16–24px, `FONT_SIZE_MIN/MAX` |
| Line spacing | Yes | **Have** | 4 steps (1.5–2.0) |
| Margins | Yes | **Have (as "measure")** | `MEASURES` (narrow/comfort/wide) controls column width, which is the web equivalent of margins |
| Justification | Left vs. justified | **Missing** | No control; CSS currently leaves default (ragged-right) |
| Themes (light/sepia/dark) | Yes + custom themes | **Have** | 4 themes (Paper/Sepia/Dusk/Ink) in `READER_THEMES`; no *user-named custom* combos, but the one persisted profile is close enough |
| Two-page/spread view | Yes on larger screens | **Have** | `pageView: "single"|"spread"` with a min-chars guard |
| Read-aloud / TTS | Yes, Assistive Reader, 0.5–3.5x, synced highlight | **Missing** | No TTS anywhere |
| Word Wise (inline hint glosses) | Yes, offline | **Missing** | — |
| Vocabulary Builder (flashcards from lookups) | Yes, automatic | **Missing** | Depends on dictionary lookup existing first |
| Whispersync (cross-device position) | Yes | **Have (architecturally, for position)** | `reading_progress` is already server-side, per-user, per-book via Clerk auth — logging in on any device already syncs position. Highlights/bookmarks will need the same treatment once they exist |
| Flashcards | Yes (vocab) | **Missing** | See Vocabulary Builder; Codex cards are an *adjacent*, richer analogue for characters |
| Share a quote | Yes, generates a shareable image | **Missing** | But `src/app/api/og/book/[bookId]/route.tsx` already does Vercel OG image generation — huge head start |
| Brightness/warmth control | Yes (hardware frontlight) | **N/A / approximated** | Web apps don't control device backlight; our 4 reading themes approximate warm↔cool paper tones |
| Auto-hiding chrome, tap zones, keyboard nav | Kindle apps have some of this | **Have** | `Reader.tsx` idle-hide header, tap zones, arrow keys, `w` toggles world rail, `Escape` exits |
| Per-scene AI illustration | No | **Have — beats Kindle** | `ChapterPlate.tsx` / `SceneView.tsx` / `useOverlay.ts` |
| In-context character chat | No | **Have — beats Kindle** | WorldRail "Chat" tab, scoped to `chunkIdx` |
| Gamified collectible companion (Codex) | No | **Have — beats Kindle** | `src/domain/codex.ts`, rarity tiers, lock/met/known states |
| UI sound design | No | **Have (partial)** | `src/lib/sound.ts` — zero-cost synthesized Web Audio *interaction* cues (button presses, card reveals), **not** ambient per-scene soundscapes yet |

---

## 2. Missing / partial features — how they'd map onto our stack

For each: what it is, how it fits our architecture, effort (S/M/L), and any
spoiler-frontier or zero-cost flag.

### Dictionary lookup (tap/select a word)
- **What**: tap-and-hold a word → inline definition popover.
- **Mapping**: add a selection listener in `Reader.tsx` (or a small `useTextSelection` hook) that opens a popover anchored to the selection range. Backing data: [Free Dictionary API](https://dictionaryapi.dev/) or [freedictionaryapi.com](https://freedictionaryapi.com/) — both **free, no API key**, sourced from Wiktionary, CORS-enabled. Proxy through a thin `/api/dictionary/[word]` route (hides the third-party call, lets us cache).
- **Effort**: S–M.
- **Zero-cost**: yes — no card needed. Cache lookups in a small `word_definitions` table (word → definition JSON) since dictionary entries are universal, not per-book/per-user — free after first lookup, shared across all readers.
- **Spoiler**: none — dictionary content is book-agnostic.

### Wikipedia lookup on selection
- **What**: for a selected real-world proper noun, show a Wikipedia summary card.
- **Mapping**: same selection popover as above, second tab. Call the [Wikimedia REST API](https://www.mediawiki.org/wiki/API:REST_API) `page/summary/{title}` endpoint server-side (requires a custom `User-Agent` header, no key). **Important distinction from X-Ray**: this is only useful for real-world references the book makes (places, historical figures, terms) — for *in-fiction* characters/places, our own Discoveries/Codex dossier is the correct (and better) answer, never Wikipedia.
- **Effort**: S once the lookup popover exists.
- **Zero-cost**: yes, free public API.
- **Spoiler**: none (Wikipedia has no idea about the book's plot).

### Translation on selection
- **What**: instant translation of selected word/phrase.
- **Mapping**: no free tier exists at a quality bar worth shipping (Google Translate/DeepL require billing; self-hosting LibreTranslate costs compute we don't have room for under the zero-cost constraint).
- **Recommendation**: **defer — flag as requiring a paid API or a card.** Do not build without explicit sign-off per the ZERO-COST CONSTRAINT.

### In-book full-text search
- **What**: search across the whole book, jump to a hit.
- **Mapping**: Postgres full-text search (`tsvector` + GIN index) over `chunks.text`, scoped by `bookId`. New route `GET /api/books/[bookId]/search?q=`, returns `{chunkIdx, snippet}[]`. Reuse the existing `?chunk=` deep-link (`ReadPageProps.searchParams`) to jump to a result.
- **Effort**: M (migration + index + route + results UI).
- **Zero-cost**: yes, native Postgres — no external service.
- **Spoiler**: **must filter results to `chunkIdx <= frontierChunk`** — an unfiltered search is a direct spoiler leak (searching a character's name could return their death scene three chapters ahead). This is the one search-feature detail that needs real care.

### Highlights (multi-color) + notes
- **What**: select text → highlight in a color, optionally attach a note.
- **Mapping**: new `highlights` table: `id, userId, bookId, chunkIdx, startOffset, endOffset, color, note (nullable), createdAt`. Offsets are stable because chunk text is static per book (no re-flow risk). Rendering: `formatChunk`'s paragraph runs need a highlight-aware render pass that splits a `TextRun` at the stored offsets.
- **Effort**: L (schema + migration + selection-range capture/restore + render-time splitting + a "Notebook" list view).
- **Zero-cost**: yes, just DB storage (already on the DB-backed storage driver).
- **Spoiler**: a reader's own highlights are theirs to see regardless of frontier (they wrote them). Only becomes a spoiler concern if we ever surface *other readers'* highlights (a social "popular passages" feature) — flag that explicitly if it's ever proposed.

### Export highlights/notes
- **What**: Kindle offers `read.amazon.com/notebook`, `My Clippings.txt`, and third-party exporters ([clippings.io](https://www.clippings.io/), [Bookcision](https://readwise.io/bookcision)).
- **Mapping**: once `highlights` exists, a simple client-side "Export" button that serializes to Markdown or plain text and triggers a download — no server or third-party service needed.
- **Effort**: S (once highlights exist).
- **Zero-cost**: yes.

### Bookmarks
- **What**: manually save a spot, multiple per book.
- **Mapping**: simplest slice of the highlights work — could even ship *before* highlights as a `bookmarks` table (`userId, bookId, chunkIdx, label?, createdAt`) with a small UI (bookmark icon in the header, a list in the rail).
- **Effort**: S.
- **Zero-cost**: yes.

### Table of contents / chapter navigation + "go to page"
- **What**: a tappable chapter list; a numeric page-jump.
- **Mapping**: `reader-format.ts` already detects `heading` blocks (chapter titles) and inline TOC blocks with pure regex — **no LLM needed**. Add a one-time server-side scan per book (on upload or lazily, cached in a new `books.tocIndex` jsonb column) that walks all chunks, records `{chunkIdx, title}` for every heading block, and serves it via a small endpoint. Render as a "Contents" tab in `WorldRail` or a header dropdown; wire "go to page" as a plain numeric input calling the existing `navigate(n - 1)`.
- **Effort**: M (mostly the one-time TOC-index scan + cache; the parsing logic and the jump mechanism already exist).
- **Zero-cost**: yes — pure regex reuse, no AI call.
- **Spoiler**: chapter *titles* are typically not spoilers on their own, but to be safe, only show TOC entries up to the frontier chunk (same pattern as the world timeline filter in `world.ts`).

### Jump-back after following a link
- **What**: return to the exact reading position after following an X-Ray/link.
- **Mapping**: in-rail tabs already don't navigate away (non-issue). For genuine route changes (e.g. a future "open full Dossier page" link from the Cast tab), always construct the link with `?chunk=<currentChunk>&return=1` back to `/books/[id]/read`, mirroring the pattern `BookInsights.tsx` already uses for its timeline deep-links.
- **Effort**: S.
- **Zero-cost**: yes.

### Reading progress: "time left in chapter/book"
- **What**: estimate remaining time using the reader's own measured pace.
- **Mapping**: `reading_progress.updatedAt` timestamps already exist on every page turn; track a rolling words-per-minute client-side (words per chunk ÷ seconds between turns, smoothed), then `remainingWords / wpm` for both "in this chapter" (to next heading) and "in book" estimates. Show next to the existing `pageLabel`.
- **Effort**: S–M.
- **Zero-cost**: yes — pure arithmetic, no API.

### Justification toggle
- **What**: left-aligned vs. fully justified body text.
- **Mapping**: one more `ReaderSettingsState` field (`justify: boolean`), a toggle in `ReaderSettings.tsx`, `text-align: justify` + `text-justify` CSS on `.reader-prose`.
- **Effort**: S.
- **Zero-cost**: yes.

### Read-aloud / TTS
- **What**: have the current page read aloud, adjustable speed.
- **Mapping**: the browser's native `window.speechSynthesis` (Web Speech API) is **built into every modern browser, entirely free, runs client-side** — feed it the current chunk's plain text (or block-by-block, using `formatChunk`'s existing block list, for coarse sentence-level highlighting via `boundary` events). Add play/pause/speed controls near `ReaderSettings`.
- **Effort**: M (playback state machine + optional highlight-sync is fiddly; basic "read this page" is much simpler).
- **Zero-cost**: yes, no server or paid TTS service. Caveat: voice quality is whatever the OS/browser ships (not Amazon's polished Ivona voices), and it's worth flagging that plainly — but it's genuinely free.

### Word Wise
- **What**: inline gloss above "hard" words.
- **Mapping**: needs a cheap "is this word hard" signal. A **static, offline common-word-frequency list** (top N thousand English words, bundled as a JSON asset — zero-cost, no LLM, no network) lets us flag words outside that list as gloss-worthy, then reuse the dictionary-lookup API (already built for word-tap) to fetch/cache a short definition for the inline hint.
- **Effort**: M–L (word-frequency asset + per-block gloss-injection logic + toggle in settings; visually needs care so it doesn't clutter the EX LIBRIS typographic voice).
- **Zero-cost**: yes.

### Vocabulary Builder (flashcards)
- **What**: every word looked up gets auto-saved to a personal flashcard deck.
- **Mapping**: a `vocabulary` table (`userId, word, definition, bookId, chunkIdx, createdAt, reviewedAt?`), populated automatically whenever the dictionary-lookup popover is used. A simple review UI ("show unreviewed, mark known") is enough to start — true spaced-repetition scheduling can come later.
- **Effort**: S once dictionary lookup exists.
- **Zero-cost**: yes.

### Whispersync (cross-device highlights/bookmarks)
- **What**: highlights/bookmarks/notes follow the reader across devices, same as position already does.
- **Mapping**: nothing new architecturally — same Clerk-authenticated, per-user DB rows pattern `reading_progress` already uses. Falls out for free once the `highlights`/`bookmarks` tables exist.
- **Effort**: included in the highlights/bookmarks effort above (no separate work).

### Share a quote
- **What**: select a passage → generate a shareable branded image card.
- **Mapping**: `src/app/api/og/book/[bookId]/route.tsx` already does Vercel OG (satori-based) image generation for book covers — extend it (or add a sibling route) to accept a quote string + book title/theme and render a shareable card in the EX LIBRIS visual language. Directly serves the "social-share cards for word-of-mouth" direction already in the product's gamified-codex notes.
- **Effort**: S–M, given the OG infra is a known quantity.
- **Zero-cost**: yes — Vercel OG image generation, no external API.

### Brightness/warmth
- **What**: Kindle's hardware frontlight color/intensity control.
- **Mapping**: not meaningfully portable to a web app (no access to device backlight). Already approximated by the 4 reading themes' warm↔cool tone range. Not worth dedicated engineering — note as N/A rather than a gap.

---

## 3. Prioritized roadmap

Ordered by reader-value ÷ cost, all waves zero-cost/card-free unless flagged.

### Wave 1 — cheap wins, ship first (mostly S effort, no schema changes)
The "no-brainer to switch from Kindle" set — small, all reuse code that
already exists:
1. **Chapter TOC + jump menu + "go to page"** — reuses existing heading-detection regex, wires into the existing `navigate()`.
2. **Justification toggle** — one CSS property + one settings field.
3. **"Time left in chapter/book"** — pure math on data we already timestamp.
4. **Share a quote** — extends the existing OG image route; high word-of-mouth leverage per the gamified-codex direction.
5. **Jump-back affordance** — one query param convention, already precedented by `BookInsights.tsx`.

### Wave 2 — word tools (free public APIs, one shared selection-popover UI)
6. **Selection popover infrastructure** (tap/select → floating panel) — the shared UI both of the next two features hang off.
7. **Dictionary lookup** (Free Dictionary API / Wiktionary-backed, cached server-side).
8. **Wikipedia lookup** for real-world terms (Wikimedia REST API) — explicitly routed away from our own entities, which stay on Discoveries/Codex.
9. **Vocabulary Builder flashcards** — falls out of (7) almost for free.

### Wave 3 — durable reader data (schema work, the biggest lift)
10. **Bookmarks** (ship first within this wave — smallest schema).
11. **Highlights (multi-color) + notes** — the big one: offsets, render-splitting, a Notebook view.
12. **Export highlights/notes** (Markdown/text download, client-side).
13. **In-book full-text search**, frontier-filtered — pairs naturally with the TOC jump UI from Wave 1.

### Wave 4 — accessibility-grade features (zero-cost but UI-fiddly)
14. **Read-aloud / TTS** via the native Web Speech API.
15. **Word Wise** inline hints via an offline frequency list + the dictionary API from Wave 2.

### Deferred / flagged (would violate or risk the zero-cost constraint)
- **Translation on selection** — no adequate free tier exists; needs a paid API or a card. Do not build without explicit approval.
- **Hardware brightness/warmth** — not applicable to a web app; already approximated by reading themes.

### Where we already beat Kindle (lean into these, don't just chase parity)
- **Discoveries/Codex** — AI-generated, frontier-gated, relationship-aware, gamified-rarity X-Ray that's *interactive*, not a static offline file.
- **Per-scene AI illustrations** (`ChapterPlate`/`SceneView`) — Kindle has nothing like this.
- **In-context character chat**, scoped to the exact page the reader is on.
- **Gamified collectible cards** with lock/met/known states — turns X-Ray into a Pokédex-style hook (per the "gamified codex direction" note), which none of Kindle/Kobo/Libby do.
- **UI sound design** (`src/lib/sound.ts`) is already a zero-cost Web Audio synthesis pattern — worth extending later into true per-scene ambient soundscapes (e.g. keyed off `visualStyle.mood`/theme archetype), which would be a genuine "beat Kindle" feature and is architecturally a small step from what's already shipped, but is **not** built yet and shouldn't be described as done.
- Cross-device position sync (Whispersync-equivalent) is **already solved** by the existing Clerk + per-user DB row pattern — new features (highlights/bookmarks) get it for free by construction.

---

## Sources

- [Amazon: Kindle Features — Search, X-Ray, Wikipedia/Dictionary Lookup, Instant Translations](https://www.amazon.com/b?ie=UTF8&node=17717476011)
- [Amazon: Kindle Bookmarks, Notes, and Highlights](https://www.amazon.com/Kindle-App-Updates/b?ie=UTF8&node=11627044011)
- [Amazon: Accessible Reading Options for Kindle Reading Apps](https://www.amazon.com/gp/help/customer/display.html?nodeId=TABlJ4ot69emTO8jJG)
- [About Amazon: Kindle accessibility features (TTS, OpenDyslexic, spacing, dark mode)](https://www.aboutamazon.com/news/books-and-authors/kindle-accessibility-features-for-all-readers)
- [clippings.io — Export your Kindle Highlights](https://www.clippings.io/)
- [Readwise Bookcision — Export/Download Kindle Highlights](https://readwise.io/bookcision)
- [textmuncher.com — Export Kindle Highlights & Notes: 4 Ways That Work](https://textmuncher.com/blog/export-kindle-highlights-notes)
- [Free Dictionary API — freedictionaryapi.com](https://freedictionaryapi.com/)
- [Free Dictionary API — dictionaryapi.dev](https://dictionaryapi.dev/)
- [MediaWiki: Wikimedia REST API](https://www.mediawiki.org/wiki/API:REST_API)
- [Wikimedia: Getting started with Wikimedia APIs](https://api.wikimedia.org/wiki/Getting_started_with_Wikimedia_APIs)
