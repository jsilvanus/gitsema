---
name: whatnext
description: Cross-check the latest docs/reviewN.md, then docs/PLAN.md, then docs/feature-ideas.md (in that priority order) against the actual source to find what's genuinely left to do, then present a prioritized findings report. Use when the user asks "what's left", "what should we do next", "what's outstanding", or wants a roadmap/backlog status check.
argument-hint: [optional focus area, e.g. "storage backends" or "LSP"]
---

This is a **read-only research and reporting** skill. Do not implement fixes,
edit files, or open PRs as part of running it — only investigate and report.
If the user wants something acted on after seeing the report, that's a
separate, explicit follow-up request.

## Why this skill exists

This repo's planning docs drift out of sync with each other and with the
code:
- `docs/PLAN.md` phases get marked complete, but the "Long-Term Investments"
  and "Non-goals" tables at the bottom are easy to forget about.
- `docs/feature-ideas.md` describes "undesigned" ideas that frequently turn
  out to have already shipped under a PLAN.md phase number, because nobody
  pruned the doc after the phase landed.
- The canonical review file named in `CLAUDE.md` (e.g. `docs/review9.md`) is
  a point-in-time snapshot. By the time anyone reads it, some fraction of its
  findings have already been fixed in later commits — **never report a
  review finding as "open" without checking the current source.**

## Priority order

Review findings outrank PLAN backlog, which outranks feature-ideas. Scan and
report in that order — review findings are concrete and time-sensitive
(often correctness/security issues against current code), PLAN backlog is
committed-to roadmap work, and feature-ideas are undesigned, lowest-priority
by definition. Don't let feature-ideas crowd the top of the report just
because that doc is longer or newer.

## What to do

1. **Find the canonical docs.** Read `CLAUDE.md`'s "Canonical documentation"
   table for the current paths to `PLAN.md`, `feature-ideas.md`, and the
   latest review file (its filename changes as new reviews are written —
   don't hardcode `review9.md`).

2. **Scan the latest review doc first.** For every numbered finding
   (especially Critical/High severity ones), verify against current source
   before trusting it:
   - For a "missing X" claim, grep for X in the cited file/module.
   - For a "function Y doesn't do Z" claim, read function Y and check.
   - Check `git log --oneline -- <file>` for the cited file to see if a later
     commit already addressed it (commit messages referencing
     "review8 §..."/"review9 §..." are a strong signal).
   - Classify each finding as **resolved** (cite the commit/code that fixed
     it), **still open** (cite the current code proving it), or
     **partially resolved** (some sub-points fixed, some not).

3. **Scan `docs/PLAN.md` second:**
   - Grep for `^### Phase` headings without `✅`/`completed` in the title,
     and read enough context around each to tell whether it's actually done
     (older phases often lack the emoji but have completion language in the
     body — don't assume an unmarked heading means undone work).
   - Read the "Long-Term Investments" and "Non-goals for now" tables at the
     bottom — these are easy to miss and are a common source of real backlog.

4. **Scan `docs/feature-ideas.md` last**, for ideas not yet in `PLAN.md`.
   For each one, check whether a later PLAN.md phase already shipped it
   (search PLAN.md for the relevant keywords/command names) — flag any idea
   that's actually done so it can be pruned later.

5. **Check changesets and version drift** (cheap, high-signal): compare
   `package.json`'s version against `docs/features.md`'s header banner and
   the latest review's stated version — stale headers are themselves a
   findable, fixable backlog item.

6. **Scan `docs/deprecations.md` for removal candidates.** gitsema's stated
   policy there is "warn forever, remove only if a specific reason arises" —
   so don't propose removal just because something is old. Only flag a §1
   hard deprecation as a **removal candidate** when there's a concrete
   reason beyond age, e.g.:
   - The deprecated form is now actively harmful or misleading to keep (a
     security gap the replacement closes, like the `--tcp`/`--websocket`
     case), not just superseded.
   - The replacement has been the documented default for many phases *and*
     a later review/PLAN entry already floats removing it (grep PLAN.md and
     the latest review for the deprecated command/flag name to check).
   - The deprecated form is untested, undocumented outside
     `deprecations.md`, or its only remaining references are the alias
     registration and its own warning (grep the whole repo, including
     `tests/`, for the deprecated form — if nothing exercises it except the
     alias itself, that's signal, not proof).
   For each candidate, state *why now* (the specific reason, not just
   "it's old") and what removing it would touch (alias registration site,
   any tests asserting the old form still works, the `deprecations.md` row
   itself). If no deprecation meets this bar, say so explicitly rather than
   forcing a candidate — most runs should find zero, given the project's
   policy.

7. **If an argument was given**, scope the scan to that area (e.g. only
   report findings/ideas/phases related to "storage backends") but still do
   the full resolved-vs-open verification pass for anything in scope.

## Output format

Present a single findings report to the user, not a wall of raw doc dumps:

1. **One-line summary** — how stale are the docs, roughly how much is
   actually left.
2. **Verified still-open items**, grouped by source **in priority order:
   review findings, then PLAN backlog, then feature-ideas** — each with: what
   it is, why it's still open (cite file:line or command output), and a
   rough size/priority estimate.
3. **Resolved-but-undocumented items** — things that are actually done but
   still listed as open in a doc; flag these for a doc-pruning pass (don't
   silently fix the docs yourself unless asked).
4. **Deprecation removal candidates** (only if any were found in step 6) —
   each with the specific "why now" reason, not just age, and what removing
   it would touch. If none were found, a one-line "no removal candidates
   this run" is enough — don't pad this section.
5. **Recommendation** — what you'd tackle first and why, in 2-3 sentences.

Keep the report tight. Cite evidence (file:line, commit hash, grep/test
output) for every claim of "open" or "resolved" — this skill's entire value
is *not* trusting the docs at face value.
