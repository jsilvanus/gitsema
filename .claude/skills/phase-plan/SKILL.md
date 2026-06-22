---
name: phase-plan
description: Take a finished design document (e.g. one produced by refine-idea) and turn it into a proper docs/PLAN.md phase entry — assigns the next phase number, writes the phase header/goal/design-link block in PLAN.md's established format, and breaks the design's implementation plan into one or more concrete phase entries. Use when a design spec is "ready to plan" and the user wants it scheduled as real roadmap work.
argument-hint: [design doc path or idea name, e.g. "docs/storage-backends-plan.md" or "Plugin API"]
---

This skill is the last hop in the idea pipeline: `createidea` → `refine-idea`
→ **`phase-plan`**. It turns a finished design document into one or more
entries in `docs/PLAN.md`, in the exact structural style PLAN.md already
uses. It does **not** write implementation code, mark phases complete, or
open a PR — it only schedules the work by adding the phase entry/entries.
Completing the phase later (writing code, updating `features.md`/`README.md`/
`parity.md`, adding a changeset per `CLAUDE.md`) is separate, explicit
follow-up work.

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

1. **Locate the design doc.** If given a path, read it in full. If given an
   idea name instead, search `docs/feature-ideas.md` for a "Refined into:"
   pointer left by `refine-idea`, or search `docs/*.md` for a matching
   `-plan.md`/design file. If no finished design doc exists yet, stop and
   tell the user to run `refine-idea` first — don't improvise a phase plan
   from a half-formed feature-ideas.md entry.

2. **Find the next free phase number.** Run
   `grep -n "^### Phase" docs/PLAN.md` (and check multi-phase headings like
   `### Phases 101–103`) to find the highest assigned number, and check the
   "LSP & MCP Fleshout Track"-style notes for any numbers already reserved
   for a future track. Use the next free number(s) — don't renumber or
   collide with reserved ranges.

3. **Decide single phase vs. phase range.** If the design's "Phased
   implementation plan" section lays out genuinely separable chunks of work
   (each independently shippable/testable, like Phases 101–103 or 113–117),
   plan a numbered range with one table row per phase (mirror the
   `### Phases 101–103` / `### Phase 113+` table-based formats in PLAN.md).
   If it's one cohesive unit of work, plan a single `### Phase N — Title`
   entry.

4. **Write the PLAN.md entry** matching existing conventions:
   - Heading: `### Phase N — Title` (no status marker yet — phases get
     `*(completed vX.Y.Z)*` or ✅ only once actually shipped).
   - **Goal:** one or two sentences, pulled from the design doc's motivation.
   - **Design:** a link to the design doc, e.g.
     `Full design and rationale ... live in [\`docs/<file>.md\`](<file>.md).
     Chosen direction: ...` — summarize the chosen direction in one sentence,
     don't restate the whole design doc.
   - For a phase range, also add the `| Phase | Spec section | Title |
     Deliverable |` table the multi-phase tracks use, with a `**Build
     order:**` note only if the design doc specifies a non-numeric order.
   - Insert the entry in the correct position — append after the highest
     existing phase number (or as a new "Track" section before the
     "Long-Term Investments"/"Non-goals" tables if it's substantial enough
     to warrant its own track heading, matching how the LSP & MCP Fleshout
     Track and Knowledge Graph Track sections are introduced).

5. **Cross-link back.** If the design doc has a header line like
   `**Targets:** Phases 101–103`, update it to the actual assigned number(s)
   if it was previously a placeholder/TBD.

6. **Do not mark anything complete, write code, touch `features.md`/
   `README.md`/`parity.md`, or create a changeset** — those happen when the
   phase actually ships, per `CLAUDE.md`'s "When implementing a new feature
   or phase" checklist. This skill only schedules.

## Output format

Report back:
1. The phase number(s) assigned and where they were inserted in PLAN.md.
2. A one-line summary of each phase's deliverable.
3. Anything from the design doc that didn't fit cleanly into a phase
   (genuinely deferred work, open questions) — flag it rather than silently
   dropping it.
