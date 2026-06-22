---
name: phase-plan
description: Take a finished design document (e.g. one produced by refine-idea) OR a direct hint/list of steps from the user, and turn it into a proper docs/PLAN.md phase entry — assigns the next phase number, writes the phase header/goal/design-link block in PLAN.md's established format, and breaks the implementation plan into one or more concrete phase entries. Use when a design spec, or a user-supplied set of steps, is "ready to plan" and the user wants it scheduled as real roadmap work.
argument-hint: [design doc path, idea name, or inline steps, e.g. "docs/storage-backends-plan.md", "Plugin API", or "1. add X 2. wire Y 3. test Z"]
---

This skill is the last hop in the idea pipeline: `createidea` → `refine-idea`
→ **`phase-plan`** — but it also accepts a shortcut straight from the user
when there's no design doc at all (see "Input modes" below). It turns either
input into one or more entries in `docs/PLAN.md`, in the exact structural
style PLAN.md already uses. It does **not** write implementation code, mark
phases complete, or open a PR — it only schedules the work by adding the
phase entry/entries. Completing the phase later (writing code, updating
`features.md`/`README.md`/`parity.md`, adding a changeset per `CLAUDE.md`)
is separate, explicit follow-up work.

## Input modes

This skill accepts two kinds of input — determine which one applies before
starting step 1:

- **Mode A — design doc.** The argument is a path or an idea name that
  resolves to a finished design document (the normal `refine-idea` hand-off).
  Follow the full flow below, including the "Design:" link-back step.
- **Mode B — direct steps from the user.** The user supplies the phase
  content directly in the prompt — a hint, a numbered/bulleted list of
  steps, or a short description of what the phase should do — with no
  backing design doc. Skip the design-doc lookup (step 1) and the
  cross-link-back step (step 5): there is no file to read or link to. Use
  the user's own wording as the source for the Goal and deliverables, ask
  one clarifying question only if the steps are too sparse to assign a
  title or tell where one phase ends and the next begins, and write the
  "Design:" field as a short inline summary of the approach instead of a
  doc link (e.g. "Design: no separate design doc — scoped directly from the
  user's request. Approach: ..."). Everything else (phase numbering,
  single-phase-vs-range judgment, insertion position, output format) works
  identically to Mode A.

## Why this skill exists

`docs/feature-ideas.md`'s own workflow says: "After designing: Move to a
dedicated design file ... and update `PLAN.md`." The first half of that
hand-off is `refine-idea`'s job; this skill does the second half, which has
historically been done ad hoc (different phases describe their design link,
goal, and deliverables with inconsistent structure). PLAN.md phases that
reference a design doc (e.g. Phases 101–103 → `storage-backends-plan.md`,
Phases 113–117 → `lsp_and_mcp_fleshout.md`) share a recognizable shape this
skill should reproduce rather than reinvent each time.

## What to do

1. **Locate the source content.**
   - **Mode A (design doc):** If given a path, read it in full. If given an
     idea name instead, search `docs/feature-ideas.md` for a "Refined into:"
     pointer left by `refine-idea`, or search `docs/*.md` for a matching
     `-plan.md`/design file. If no finished design doc exists and no inline
     steps were given either, stop and tell the user to run `refine-idea`
     first — don't improvise a phase plan from a half-formed
     feature-ideas.md entry.
   - **Mode B (direct steps):** If the user supplied the steps/hint directly
     instead of pointing at a doc, use that text as-is — no file lookup
     needed. If it's too thin to derive a title, goal, and at least one
     concrete deliverable, ask a clarifying question before proceeding
     rather than inventing scope.

2. **Find the next free phase number.** Run
   `grep -n "^### Phase" docs/PLAN.md` (and check multi-phase headings like
   `### Phases 101–103`) to find the highest assigned number, and check the
   "LSP & MCP Fleshout Track"-style notes for any numbers already reserved
   for a future track. Use the next free number(s) — don't renumber or
   collide with reserved ranges.

3. **Decide single phase vs. phase range.** If the source content (design
   doc's "Phased implementation plan" section, or the user's own step list
   in Mode B) lays out genuinely separable chunks of work (each
   independently shippable/testable, like Phases 101–103 or 113–117), plan
   a numbered range with one table row per phase (mirror the
   `### Phases 101–103` / `### Phase 113+` table-based formats in PLAN.md).
   If it's one cohesive unit of work, plan a single `### Phase N — Title`
   entry. In Mode B, a short flat list of steps is usually one cohesive
   phase unless the user's steps explicitly describe independently
   shippable stages.

4. **Write the PLAN.md entry** matching existing conventions:
   - Heading: `### Phase N — Title` (no status marker yet — phases get
     `*(completed vX.Y.Z)*` or ✅ only once actually shipped).
   - **Goal:** one or two sentences, pulled from the design doc's motivation
     (Mode A) or distilled from the user's stated intent (Mode B).
   - **Design:**
     - Mode A: a link to the design doc, e.g. `Full design and rationale ...
       live in [\`docs/<file>.md\`](<file>.md). Chosen direction: ...` —
       summarize the chosen direction in one sentence, don't restate the
       whole design doc.
     - Mode B: no doc to link — write a short inline summary instead, e.g.
       `Design: no separate design doc — scoped directly from the user's
       request. Approach: ...`, followed by the user's steps rendered as the
       deliverable list (see below).
   - For a phase range, also add the `| Phase | Spec section | Title |
     Deliverable |` table the multi-phase tracks use, with a `**Build
     order:**` note only if the source specifies a non-numeric order. In
     Mode B, "Spec section" can reference the user's own step numbers
     instead of a doc section.
   - Insert the entry in the correct position — append after the highest
     existing phase number (or as a new "Track" section before the
     "Long-Term Investments"/"Non-goals" tables if it's substantial enough
     to warrant its own track heading, matching how the LSP & MCP Fleshout
     Track and Knowledge Graph Track sections are introduced).

5. **Cross-link back (Mode A only).** If the design doc has a header line
   like `**Targets:** Phases 101–103`, update it to the actual assigned
   number(s) if it was previously a placeholder/TBD. Skip this step
   entirely in Mode B — there is no design doc to update.

6. **Do not mark anything complete, write code, touch `features.md`/
   `README.md`/`parity.md`, or create a changeset** — those happen when the
   phase actually ships, per `CLAUDE.md`'s "When implementing a new feature
   or phase" checklist. This skill only schedules.

## Output format

Report back:
1. The phase number(s) assigned and where they were inserted in PLAN.md.
2. A one-line summary of each phase's deliverable.
3. Anything from the source content (design doc, or the user's own steps in
   Mode B) that didn't fit cleanly into a phase — genuinely deferred work or
   open questions — flag it rather than silently dropping it.
