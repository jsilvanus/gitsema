---
name: refine-idea
description: Take an existing entry in docs/feature-ideas.md and refine it into a full design document — resolves the Design Gaps through clarifying questions and codebase research, then writes a standalone docs/<name>-plan.md (or docs/design/<name>.md) spec. Use when the user wants to move an idea from "rough sketch" to "ready to plan as a PLAN.md phase."
argument-hint: [idea name or heading from feature-ideas.md, e.g. "Plugin API for Custom Analysers"]
---

This skill promotes one `docs/feature-ideas.md` entry into a real design
document. It **does** create/edit a design doc file, and **may** trim or
annotate the source entry in `feature-ideas.md` once it's superseded. It does
**not** add phases to `docs/PLAN.md`, write implementation code, or open a PR
— turning the finished design into an active phase is a separate, explicit
follow-up request.

## Why this skill exists

`docs/feature-ideas.md`'s own "How to Use This Document" section says: "After
designing: Move to a dedicated design file ... and update `PLAN.md`." That
hand-off has historically not happened consistently — ideas accumulate
Design Gaps lists but never graduate into the kind of document that exists
for past designs like `docs/storage-backends-plan.md` or
`docs/lsp_and_mcp_fleshout.md` (motivation → conceptual model → options
considered → chosen direction → phased implementation plan). This skill does
that promotion deliberately: resolve the open questions instead of carrying
them forward, then write the doc in the shape PLAN.md phases actually get
written from.

## What to do

1. **Locate the idea.** Find the named section in `docs/feature-ideas.md`
   (use the argument if given; otherwise ask which entry). Read it in full,
   including its Problem / Intended Behavior / Design Gaps / Effort Estimate
   / Prerequisites.

2. **Survey precedent.** Skim 1–2 existing design docs that resemble this
   idea's shape (e.g. `docs/storage-backends-plan.md` for an infra/backend
   choice, `docs/lsp_and_mcp_fleshout.md` for a protocol/interface feature,
   `docs/knowledge-graph.md` for a data-model feature) to match this repo's
   established design-doc structure: motivation, conceptual model/options
   considered, chosen direction with rationale, phased implementation plan,
   open questions that remain even after refinement.

3. **Research the codebase** for anything the Design Gaps depend on — read
   the relevant modules under `src/core/` so the design's "chosen direction"
   is grounded in what already exists (existing interfaces to extend, prior
   art for similar plumbing, naming/schema conventions to follow per
   `CLAUDE.md`'s design constraints and conventions sections).

4. **Resolve the Design Gaps.** Go through each open question from the
   feature-ideas.md entry one at a time:
   - If the codebase or precedent docs already answer it, answer it yourself
     and cite the evidence — don't re-ask the user something discoverable.
   - If it's a genuine product/scope decision, ask the user via
     `AskUserQuestion` (or plain text for open-ended ones). Batch related
     questions rather than going one at a time.
   - If a question truly can't be resolved yet (needs user feedback after a
     prototype, etc.), keep it as an explicit "Open Question" in the design
     doc rather than inventing an answer — that's honest scope, not a gap in
     the refinement.

5. **Write the design document.** Pick a filename consistent with existing
   docs (`docs/<topic>-plan.md` for an infra-shaped design, or
   `docs/design/<topic>.md` if it's a single self-contained feature — check
   which existing doc this idea most resembles and follow that precedent).
   Structure it like the precedent docs:
   - **Header**: status (`draft`/`accepted`), target phase numbers if known,
     scope summary.
   - **Motivation**: pull from the feature-ideas.md Problem section, expanded.
   - **Conceptual model / options considered**: lay out the real alternatives
     and tradeoffs — don't present only the chosen path as if no others
     existed.
   - **Chosen direction**: with rationale tied to this repo's constraints
     (CLI-first, blob-first, streaming, etc. per `CLAUDE.md`).
   - **Phased implementation plan**: break the work into phases sized like
     existing `PLAN.md` phases, each with a rough scope/effort note — this is
     what makes the doc "ready to plan."
   - **Remaining open questions**: anything genuinely deferred per step 4.

6. **Update `docs/feature-ideas.md`**: replace the refined entry's body with
   a short pointer (`**Refined into:** see docs/<file>.md`) rather than
   deleting it outright — keeps history of where the idea came from. Update
   the `**Last updated:**` date at the top of the file.

7. **Do not touch `docs/PLAN.md`, write code, or open a PR.** Tell the user
   the design doc is ready for a PLAN.md phase entry and let them decide when
   to do that.

## Output format

Report back:
1. The path to the new design document and its phased implementation plan
   summary (phase count, rough total size).
2. Which Design Gaps you resolved yourself (with citation) vs. resolved via
   the user's answers vs. left as open questions in the doc.
3. The pointer left in `feature-ideas.md`.
