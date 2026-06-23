---
name: execute-plan
description: Take a hint identifying which phase(s) in docs/PLAN.md to implement, and actually build them — write the code and tests, update docs/PLAN.md (mark complete, note deviations), docs/features.md, README.md, docs/parity.md, docs/deprecations.md as applicable, and add a changeset. Use when the user wants to implement, build, or ship a phase that's already scheduled in PLAN.md (as opposed to phase-plan, which only schedules it).
argument-hint: [phase number(s) or hint, e.g. "122", "122-125", "the multi-tenant auth track", "Phase A of the auth track"]
---

This skill is the opposite end of the pipeline from `phase-plan`: where
`phase-plan` only *schedules* work into `docs/PLAN.md` without writing code,
`execute-plan` takes an already-scheduled phase and actually *builds* it —
code, tests, and the full doc-maintenance checklist `CLAUDE.md` requires for
a shipped phase. It **does** write/edit source files, run the test suite,
edit `docs/PLAN.md`/`docs/features.md`/`README.md`/`docs/parity.md`/
`docs/deprecations.md`, and add a changeset. It does **not** commit, push,
open a PR, or merge unless the user explicitly asks for that as a separate
step — landing the code is this skill's job; shipping the commit is the
user's call, same as every other skill in this pipeline.

## Why this skill exists

`docs/PLAN.md` accumulates phase entries (via `phase-plan` or written
directly) that describe *what* to build and link back to a design doc's
*why*, but nothing in the existing skill set actually does the building.
`CLAUDE.md`'s "When implementing a new feature or phase" checklist (7 steps:
features.md, README.md, PLAN.md completion mark, parity.md, deprecations.md,
review-doc awareness, changeset) is currently followed ad hoc, phase by
phase, with no single skill ensuring all seven steps happen together. This
skill exists to make "implement Phase N" a repeatable, complete operation
instead of a checklist someone has to remember by hand.

## What to do

1. **Locate the target phase(s).** Resolve the hint to one or more concrete
   `### Phase N — Title` (or `### Phases N–M — Title`) entries:
   - A bare number or range (`"122"`, `"122-125"`) — grep `docs/PLAN.md` for
     that heading directly.
   - A track/title name (`"the multi-tenant auth track"`) — grep for the
     `## <Track name> Track` heading and its phase table.
   - A sub-phase label (`"Phase A of the auth track"`) — multi-phase tracks
     reference design-doc phase letters (Phase A/B/C/D) in their `| Phase |
     Spec section | ... |` table's "Spec section" column; match the letter
     to the correct numbered phase row.
   If the hint doesn't resolve to anything in `docs/PLAN.md`, say so and
   stop — don't invent a phase to build. If it resolves to a phase already
   marked `✅ complete`/`*(completed vX.Y.Z)*`, tell the user it's already
   shipped and ask whether they mean something else before doing any work.

2. **Read the full phase entry and its linked design doc.** Phase entries
   written by `phase-plan` link back to a `docs/<name>-plan.md` (or
   `docs/design/<name>.md`) via a **Design:** line — read that doc in full
   for the actual implementation detail (schema shapes, route changes, CLI
   surface, conceptual model) the PLAN.md entry only summarizes. For
   Mode-B-style phases with no linked doc, the PLAN.md entry's own
   **Goal:**/**Design:**/deliverable bullets are the full spec.

3. **Check dependencies before starting.** If the phase entry or its track
   header states a dependency (e.g. "hard-depends on Phase 122/123",
   "Build order: A → C → D → B") on another phase, verify that prerequisite
   phase is already marked complete in `docs/PLAN.md`. If it isn't, stop and
   tell the user which prerequisite phase needs to land first — don't build
   out of order even if it looks technically possible, since later phases
   are often written assuming the earlier phase's schema/interfaces exist.
   If multiple phases were targeted by the hint (a whole track), build them
   in the stated/dependency order, one phase at a time, not interleaved.

4. **Survey existing code before writing new code.** Read the modules the
   phase will touch or extend (schema, routes, CLI registration, the
   relevant `src/core/*` subsystem) so new code follows existing naming,
   error-handling, and structural conventions per `CLAUDE.md`'s "Development
   conventions" and "Design constraints" sections — ESM `.js` import
   extensions, strict TypeScript, no barrel exports, per-blob error handling
   in indexing paths, `logger.ts` not `console.log` in library code, no new
   CLI commands without registering them in `src/cli/index.ts`.

5. **Implement the phase's deliverables.** Write the code (schema
   migrations, routes, CLI commands, core logic) and accompanying tests
   (`tests/*.test.ts` unit, `tests/integration/` for end-to-end) per
   `CLAUDE.md`'s testing conventions — including closing any opened
   `better-sqlite3` handle (`session.rawDb.close()`) before temp-dir cleanup
   in new integration tests, per the Windows-CI note in `CLAUDE.md`. If the
   phase entry describes work bigger than fits one reasonable session,
   implement a coherent, independently-testable subset and say explicitly
   what's deferred — don't half-implement silently.

6. **Run the test suite.** `pnpm build && pnpm test` (or a scoped
   `pnpm test -- <file>` first while iterating). Fix failures before
   proceeding; don't report a phase as built with a red test suite.

7. **Run the full doc-maintenance checklist** from `CLAUDE.md`'s "When
   implementing a new feature or phase" section:
   - Add the feature to `docs/features.md` under the relevant group.
   - Update command/option tables in `README.md` if a new command/flag was
     added.
   - Mark the phase `✅ complete` (or `*(completed vX.Y.Z)*` once a version
     is known — leave the version placeholder if not yet released) in
     `docs/PLAN.md`, noting any deviations from the original spec in the
     phase entry's body.
   - Update `docs/parity.md` if the change affects tool availability across
     CLI/REPL/Guide/MCP/HTTP or adds/modifies flags — delegate this check to
     the `parity-check` skill rather than re-deriving its logic here.
   - Update `docs/deprecations.md` if anything was deprecated or removed as
     part of this phase.
   - Check the latest review doc named in `CLAUDE.md`'s canonical-docs table
     for findings this phase resolves, and note the resolution if relevant.

8. **Add a changeset** (`pnpm exec changeset` or a `.changeset/<kebab-name>.md`
   file directly) per `CLAUDE.md`'s "Releases & changesets" section — `minor`
   for a new phase/feature, `patch` for a hotfix-shaped phase. This is
   required, not optional, per `CLAUDE.md`.

9. **Do not commit, push, open a PR, or merge** unless the user explicitly
   asks for that as a following step — building and documenting the phase
   is this skill's full scope; shipping the result is a separate decision.

## Output format

Report back:
1. Which phase(s) were targeted and resolved, and which were actually
   implemented vs. deferred (with a one-line reason for any deferral).
2. A summary of what was built (files touched, schema/route/CLI changes)
   and the test results (`pnpm test` pass/fail summary).
3. Which doc-maintenance steps were completed (features.md, README.md,
   PLAN.md completion mark + deviation notes, parity.md, deprecations.md)
   and the changeset filename added.
4. Any dependency blockers found in step 3 that prevented starting a
   requested phase, stated explicitly so the user can decide what to do.
