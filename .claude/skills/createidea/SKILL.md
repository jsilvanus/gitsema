---
name: createidea
description: Turn a user's rough hint about a new feature into a properly-formed entry in docs/feature-ideas.md — asks clarifying questions first, checks it isn't already shipped or duplicated, then writes the entry in the doc's existing format. Use when the user wants to propose, brainstorm, or jot down a new feature idea that isn't ready for PLAN.md yet.
argument-hint: [rough idea or hint, e.g. "something like a plugin marketplace"]
---

This skill turns a hint into a documented idea. It **does** edit
`docs/feature-ideas.md`, but it does not touch `docs/PLAN.md`, write code, or
open a PR — promoting an idea into active development is a separate,
explicit follow-up request.

## Why this skill exists

`docs/feature-ideas.md` is the staging area for "undesigned" ideas — concepts
not yet in `PLAN.md` and without a dedicated design file. Its own "How to Use
This Document" section says to verify an idea isn't already captured before
adding it, and entries follow a consistent shape (Problem / Intended Behavior
/ Design Gaps / Effort Estimate / Prerequisites). A hastily-appended entry
that skips clarification or duplicates existing content is worse than no
entry — it adds to the doc drift the `whatnext` skill exists to detect.

## What to do

1. **Read the user's hint** (the argument, or whatever they just described).
   Read `docs/feature-ideas.md` in full and skim `docs/PLAN.md` headings
   (`^### Phase`) for anything that overlaps.

2. **Check it isn't already done or already proposed.** Grep `PLAN.md` and
   `feature-ideas.md` for the idea's key nouns/verbs. If it's already shipped
   as a phase, tell the user and stop (don't create a duplicate entry) unless
   they want a *different, unshipped* angle on it. If a similar idea already
   exists in `feature-ideas.md`, ask the user whether to extend that section
   instead of creating a new one.

3. **Ask clarifying questions** before writing anything. Use `AskUserQuestion`
   for concrete forks (e.g. "should this be a CLI command, an MCP tool, or
   both?"), and ask in plain text for open-ended framing questions. At
   minimum, get enough to fill in:
   - **Problem** — what's missing today, who hits it, why it matters.
   - **Intended Behavior** — what the feature does from a user's point of
     view (rough CLI/API shape is welcome, doesn't need to be final).
   - **Design Gaps** — open questions the user hasn't resolved yet (there
     will almost always be some; that's the point of this document).
   - **Effort estimate** — rough size if the user has a sense of it; if not,
     give your own estimate and flag it as a guess.
   - **Prerequisites** — anything that has to land first (another phase, an
     infra piece, a decision).

   Don't interrogate exhaustively — two or three rounds of questions is
   normal, but if the user is clearly thinking out loud, let the idea stay
   loose and mark the open questions as Design Gaps rather than blocking on
   answers.

4. **Write the entry** into `docs/feature-ideas.md`:
   - Match the existing section format exactly (see the "Plugin API for
     Custom Analysers" section for the template: `###` heading, then
     `### Problem`, `### Intended Behavior` or `### Vision`/`### Architecture`
     if it's a larger concept, `### Design Gaps` as a checklist, `### Effort
     Estimate`, `### Prerequisites`).
   - Insert it before the `## Related Issues & Documents` section, separated
     by `---` like the existing entries.
   - Update the `**Last updated:**` date at the top of the file to today's
     date.
   - Do not remove or rewrite unrelated existing sections.

5. **Add a changeset** if the repo's conventions call for one — check
   `CLAUDE.md`'s "Releases & changesets" section. A docs-only addition to a
   staging document is usually fine to leave changeset-free (internal-only
   change), but ask the user if unsure.

6. **Do not commit, push, or open a PR** unless the user explicitly asks —
   report back what was added and where, and let the user decide whether to
   commit it.

## Output format

After writing the entry, tell the user:
1. Where the new section landed (heading + line range).
2. Any open Design Gaps you captured rather than resolved.
3. Whether you found and avoided a duplicate/already-shipped idea, citing
   the PLAN.md phase or feature-ideas.md section you checked against.
