---
name: verify-app
description: Verify Story Worlds end-to-end — boot the dev stack, exercise the changed flow in a real browser, check DB state. Use after any nontrivial change to app code, before committing.
---

# Verify Story Worlds

Static checks alone don't count as verification here. Drive the real app.

## 1. Static gate (fast, always)
```bash
npx tsc --noEmit && npm run check:contrast
```

## 2. Boot the stack
```bash
npm run dev            # Next dev server on :3000 (PGlite auto-migrates on first query)
npx inngest-cli dev    # ONLY needed when testing the analysis pipeline (M2+)
```
Dev mode needs no env keys: Clerk runs keyless, DB is PGlite at `.data/pglite`, storage is local `.data/`, LLM falls back to the mock driver.

## 3. Exercise the flow
Use the Playwright MCP tools (browser_navigate, browser_click, browser_snapshot) against http://localhost:3000. Minimum flows by area touched:
- **Auth/shell**: land on /, sign in (keyless), reach /shelf.
- **Reader (M1+)**: upload a small public-domain PDF via the UI, open it, page with arrow keys, change typography settings, reload → position restored.
- **Pipeline (M2+)**: with inngest dev running, upload → watch world-forming progress → world rail populates; check `jobs` row reaches completed.
- **Chat (M4+)**: open a character, send a message in story-so-far mode, confirm streamed reply.

## 4. Inspect state when suspicious
PGlite is a directory database — do NOT open it with psql. Query through a scratch script:
```bash
npx tsx -e "import('./src/db/index.ts').then(async m => { await m.dbReady; console.log(await m.db.query.books.findMany()); })"
```

## 5. Reset dev state
```bash
rm -rf .data   # wipes DB + uploaded files; next boot re-migrates
```

Report what you drove and what you observed — not just "typecheck passed".
