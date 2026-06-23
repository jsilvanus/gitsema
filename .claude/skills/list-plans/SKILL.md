---
name: list-plans
description: Read docs/PLAN.md and output a plain bullet list of planned (not-yet-completed) phases — no analysis, no source-code verification, no recommendations. Use when the user just wants to see what's queued up in PLAN.md, as opposed to whatnext's full audit.
argument-hint: [optional filter, e.g. "auth" or "122-130" — defaults to all planned phases]
---

This is a **read-only listing** skill. It does not edit any file, does not
verify claims against source code, does not prioritize or recommend
anything, and does not run `phase-plan` or `execute-plan`. It is
deliberately the lightest possible "what's queued up" check — for an actual
audit that cross-checks docs against reality, use `whatnext` instead.

## What to do

1. **Read `docs/PLAN.md`.** Grep `^### Phase` and `^### Phases` (and
   `^## .*Track` headings, which group multi-phase tables) to find every
   phase entry.

2. **Filter to planned phases only** — i.e. exclude anything marked
   `✅ complete` or `*(completed vX.Y.Z)*` in its heading or status line.
   Multi-phase tracks/tables: include only the individual phase rows that
   aren't marked `✅`/complete; if the whole track is already `✅ complete`,
   skip it entirely.

3. **If an argument was given**, narrow the list to phases whose number,
   title, or track name matches it (e.g. "auth" → the Multi-Tenant Auth
   Track phases; "122-130" → that numeric range). Otherwise list everything
   still planned.

4. **Output one bullet per phase**, in ascending phase-number order:
   `- Phase N — Title` (or `Phases N–M — Title` for an unsplit range still
   shown as one entry in PLAN.md). Nothing else — no goal text, no
   deliverable summaries, no dependency notes, no editorializing.

## Output format

A bullet list of planned phases, nothing more. If nothing matches (or
everything in scope is already complete), say so in one line instead of an
empty list.
