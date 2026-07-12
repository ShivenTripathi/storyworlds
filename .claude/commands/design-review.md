---
description: Run a screenshot-driven design & UX critique of a running UI surface (uses the design-review agent + agent-browser).
---

Run a design review of the surface(s) the user names in `$ARGUMENTS` (default: whatever UI changed in the current diff — check `git diff --name-only` for `src/components/**` and `src/app/**` paths, and map them to routes).

1. Ensure the dev server is running (`npm run dev`; the analysis pipeline also needs `npx inngest-cli dev -u http://localhost:3000/api/inngest`). If it isn't, start it.
2. Launch the **design-review** agent (subagent_type: "design-review") with the specific routes/surfaces to review and any relevant context (what changed and why).
3. Relay the agent's ranked findings, then ask the user which they want applied — or apply the [Blocker]/[High] ones directly if they're unambiguous.

Surfaces → routes reference: landing `/`, shelf `/shelf`, book detail `/books/[id]`, reader `/books/[id]/read`, dossier `/books/[id]/characters/[entityId]`, settings `/settings`, admin `/admin`.
