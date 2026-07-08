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
Use the **agent-browser CLI** (installed globally; run `agent-browser skills get core` once per session for the ref workflow) against http://localhost:3000:
```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i        # @eN refs; re-snapshot after every page change
agent-browser click @e3 / fill @e2 "..." / screenshot check.png
agent-browser close              # when done
```
Minimum flows by area touched:
- **Auth/shell**: land on /, sign in (keyless), reach /shelf.
- **Reader (M1+)**: upload a small public-domain PDF via the UI, open it, page with arrow keys, change typography settings, reload → position restored.
- **Pipeline (M2+)**: with inngest dev running, upload → watch world-forming progress → world rail populates; check `jobs` row reaches completed.
- **Chat (M4+)**: open a character, send a message in story-so-far mode, confirm streamed reply.

## 4. Inspect state when suspicious
PGlite is a **single-process** directory database: while `npm run dev` is running, no other process (psql, tsx scripts) can open it — attempts crash with `RuntimeError: Aborted()`. Inspect state through the app instead (hit an API route with the browser, or add a temporary dev-only route), or stop the dev server first and then run a scratch script:
```bash
npx tsx scripts/_q.mts   # only with the dev server STOPPED
```

## 5. Reset dev state
```bash
rm -rf .data   # wipes DB + uploaded files; next boot re-migrates
```
Known failure mode: PGlite is single-connection and can corrupt on unclean shutdown (`pkill` of the dev server). Symptom: `RuntimeError: Aborted()` on any DB query after restart. Fix: stop everything, `rm -rf .data`, reboot, re-seed.

Report what you drove and what you observed — not just "typecheck passed".
