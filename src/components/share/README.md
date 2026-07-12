# Social sharing layer

Built by the share-layer agent under strict file ownership
(`src/app/api/og/**`, `src/app/api/share/**`, `src/components/share/**`
only). Nothing outside those paths was touched — the orchestrator wires this
into pages. `src/app/api/share/**` was reserved by the brief but ended up
unused: everything needed turned out to belong under `api/og/**`
(image generation) and `components/share/**` (the button); there was no
separate "create a share record" endpoint to build. Delete the empty
directory or repurpose it if a future feature needs it.

## What exists

- `src/app/api/og/book/[bookId]/route.tsx` — public OG image for a book
  share card.
- `src/app/api/og/achievement/route.tsx` — public OG image for a milestone
  card.
- `src/app/api/og/_lib/theme.ts`, `_lib/Frame.tsx` — shared literal-hex EX
  LIBRIS chrome for both routes (not a route itself).
- `src/components/share/ShareButton.tsx` — the in-app trigger.

## OG routes

### `GET /api/og/book/:bookId`

Query params (all optional, all aggregate — never per-entity):

| param   | meaning                                   |
| ------- | ------------------------------------------ |
| `cast`  | cast members discovered so far (int ≥ 0)   |
| `total` | total cast size for the book (int ≥ 0)     |
| `days`  | days reading / to finish (int ≥ 0)         |

Server-side, the route looks up **only** the book's `visibility`. If it's
not `'published'` (private, or the id doesn't resolve to a real book), the
route ignores every query param and renders the generic "A private world on
Story Worlds" fallback — no title, no author, ever. This is enforced
regardless of what the caller passes, so a guessed/private `bookId` can't be
used to fish for a book's existence or title.

### `GET /api/og/achievement`

Query params:

| param     | meaning                                                                 |
| --------- | ------------------------------------------------------------------------ |
| `kind`    | one of `full-cast \| deep-reader \| streak \| finished \| first-scene \| custom` — picks the accent glyph |
| `label`   | headline, e.g. `"Full Cast"` (≤60 chars)                                |
| `detail`  | subline, e.g. `"13 of 13 characters discovered"` (≤90 chars)           |
| `bookId`  | optional UUID — resolved server-side to a book **title** to print under the headline, ONLY if that book's `visibility === 'published'` |

`label`/`detail` are free text from the query string — spoofable, but that
only vandalizes the one link someone hand-crafts and shares themselves (per
spec: acceptable). No reader-specific or per-entity DB data is ever read by
this route; `bookId` is used exclusively to look up a title, and only
surfaces it for published books.

Both routes: 1200×630, inline styles only (`ImageResponse`/satori doesn't
read Tailwind/CSS vars), `Cache-Control: public, max-age=3600,
s-maxage=86400`, and always return a 200 image — malformed/oversized query
params fall back to schema defaults rather than erroring, since a broken
image is worse than a generic one in a social-media unfurl.

## `ShareButton` props

```tsx
type ShareButtonProps =
  | {
      kind: "book";
      bookId: string; // must be a PUBLISHED book id — see wiring note below
      title: string;
      author?: string | null;
      castMet?: number;
      castTotal?: number;
      daysReading?: number;
      className?: string;
    }
  | {
      kind: "achievement";
      achievementKind:
        | "full-cast"
        | "deep-reader"
        | "streak"
        | "finished"
        | "first-scene"
        | "custom";
      label: string;
      detail?: string;
      bookId?: string; // optional book attribution
      className?: string;
    };
```

It renders a "Share" button that opens a small sheet with: native
`navigator.share()` (when supported), "Copy link", and "Save image" (an
anchor straight at the matching `/api/og/...` URL). All chrome uses design
tokens (`var(--primary)`, `var(--card)`, `var(--border)`, `var(--muted)`,
`var(--ring)`, `font-ui`) — none of the hardcoded OG hex values leak into
this component.

**Caller responsibility**: only pass `kind: "book"` for a book the viewer
knows is published (e.g. gate on `book.visibility === "published"` before
rendering the button at all). The OG route re-checks visibility itself and
will render the safe fallback either way, but there's no reason to offer a
reader a "Share" button that quietly produces a blank card for their own
private book.

## Wiring instructions (orchestrator — not done by this agent)

1. **Book page share button.** Wherever a reader can see one specific
   published book (dashboard/book detail, wherever that ends up living),
   add:

   ```tsx
   {book.visibility === "published" && (
     <ShareButton
       kind="book"
       bookId={book.id}
       title={book.title}
       author={book.author}
       castMet={bookStats.castMet}
       castTotal={bookStats.castTotal}
       daysReading={/* whatever "days reading" ends up meaning for that page */}
     />
   )}
   ```

   `bookStats` comes from the existing `getBookStats` call that page already
   makes (or should make) — this component takes plain numbers, it does not
   call analytics itself.

2. **Codex / achievement moments.** Wherever the gamified Codex or reader
   stats surface a completed milestone (full cast collected, a reading
   streak, "Deep Reader" threshold, etc.), add:

   ```tsx
   <ShareButton
     kind="achievement"
     achievementKind="full-cast"
     label="Full Cast"
     detail={`${codex.counts.character?.met ?? 0} of ${codex.counts.character?.total ?? 0} characters discovered`}
     bookId={book.id}
   />
   ```

   Only pass `bookId` when it's safe to attribute the achievement to a
   specific (published-or-not — the route re-checks) book; omit it for
   cross-book milestones like a reading streak.

3. **`generateMetadata` on the pages that host a share button** (so the
   *page itself* unfurls nicely when the deep link is pasted, independent of
   the button): add `openGraph.images` pointing at the same OG route/params
   the button uses, e.g.:

   ```tsx
   export async function generateMetadata({ params }): Promise<Metadata> {
     const book = await getBook(params.bookId); // however that page already fetches it
     const ogImage =
       book?.visibility === "published"
         ? `${env.APP_URL}/api/og/book/${book.id}?cast=${castMet}&total=${castTotal}`
         : `${env.APP_URL}/api/og/book/${book?.id ?? "unknown"}`; // fallback card either way

     return {
       title: book?.visibility === "published" ? book.title : "Story Worlds",
       openGraph: {
         images: [{ url: ogImage, width: 1200, height: 630 }],
       },
     };
   }
   ```

   Repeat the same pattern for an achievement-sharing page/route segment if
   one exists, pointing at `/api/og/achievement?...`.

4. No new env vars are required — the OG routes build their image from the
   request itself, and `ShareButton` derives its share/destination URL from
   `window.location.origin` at click time (works unmodified in dev and
   prod, no `NEXT_PUBLIC_APP_URL` needed).
