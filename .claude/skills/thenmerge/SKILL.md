---
name: thenmerge
description: Create a PR (or update the existing one) for the current branch's changes, write/update its description, wait for CI up to 7 minutes, and merge if it's green. Use when the user wants to ship the current work end-to-end — "create the PR and merge it", "ship this", "/thenmerge" — as the terminal step after development/cleanup work is done.
argument-hint: "[optional: 'force merge' to merge even if CI is red/pending, or a path/area hint like 'only the lsp fix' to scope the PR to a subset of the current changes]"
---

This skill **does** open or update a PR, push commits, and merge — those are
the deliverable, not side effects to ask permission for, since invoking this
skill is itself the user's authorization for that scope. It does not relax
any other guardrail: still never force-push, never skip CI, never merge a
*different* PR than the one this run produced unless told to.

## Why this skill exists

"Create a PR, wait for CI, merge if green" is a recurring multi-step request
in this repo (PR creation → description → CI poll → merge), and the
CI-polling part is non-obvious here specifically: `send_later` isn't
available in this environment, and a CI run turning **green** does not
deliver a webhook event (only failures and review comments do — see
`CLAUDE.md`'s "PR babysitting in this environment" section). Without a named
skill this gets re-derived, and frequently mis-derived (e.g. forgetting that
the poll has to be an active backgrounded wait, not a webhook subscription),
every time someone wants the standard "ship it" flow.

## Default scope: the whole current branch

By default, the PR covers **all commits on the current branch** that aren't
yet on `main` (i.e. exactly what `git diff main...HEAD` shows), and targets
`main`. Don't narrow scope on your own initiative.

## Scoping hint: "only part of the project"

If the user's invocation names a subset of the current work (a path, a
component, "just the X fix", etc.), don't put the whole branch into one PR:

1. Identify which commits/files on the current branch correspond to the
   named subset (`git log --oneline`, `git diff main...HEAD --stat`).
2. Create a **new branch off `main`** (not off the current working branch)
   containing only that subset — cherry-pick the relevant commits, or if the
   subset isn't cleanly commit-separable, ask the user once via
   `AskUserQuestion` how they want it split rather than guessing at a manual
   diff/patch split.
3. Push that new branch and open the PR from it, per the steps below. Leave
   the rest of the current branch's work for a separate PR (don't open one
   for it unless asked) — note in your final report what was left out and
   why.

## What to do

1. **Check for an existing open PR for this branch first.** Use
   `pull_request_read` (or `list_pull_requests`) to see if one already
   exists for the current (or newly-created scoped) branch → `main`. If one
   exists, update it (description, push any new commits) rather than
   creating a duplicate.

2. **Push the branch.** `git push -u origin <branch-name>` per the standard
   git-push convention (retry on network failure with the documented
   backoff). Skip if already up to date.

3. **Create the PR** (or update the existing one) targeting `main` by
   default, via `mcp__github__create_pull_request` (or `update_pull_request`
   if one already exists):
   - Title: short (under 70 chars), summarizing the change.
   - Body: a `## Summary` (1-3 bullets of what changed and why) and a
     `## Test plan` checklist, same format as the global PR-creation
     convention in this environment's instructions. Base the content on the
     actual commits in scope (`git log`, `git diff main...HEAD`) — don't
     describe work that isn't in this PR's diff.

4. **Wait for CI, polling actively — do not rely on webhook events for
   this.** CI-success delivers no webhook in this environment, so:
   - Start a backgrounded wait (Bash `run_in_background`, e.g. `sleep 90`)
     and re-check `pull_request_read` → `get_status`/`get_check_runs` after
     each wake, repeating until either all checks report a conclusion or a
     **total of 7 minutes** has elapsed since the PR was created/updated.
   - Do not use `ScheduleWakeup`/`send_later` for this short a window — at
     7 minutes max, an active poll inside this turn is simpler and faster
     than ending the turn and waiting for a re-invocation.
   - If new commits get pushed to the PR mid-poll (e.g. a CI auto-fix), the
     7-minute budget restarts from that push, not from PR creation.

5. **Decide whether to merge, based on the state at the 7-minute mark (or
   earlier, if all checks already concluded):**
   - **All checks green, `mergeable_state` clean →** merge now via
     `merge_pull_request`. This is the default outcome the skill exists to
     reach — don't ask for confirmation, the user invoking `/thenmerge`
     already authorized it.
   - **Still pending/running at 7 minutes →** do not merge. Report the
     current state (which checks are still running) and stop — don't
     extend the wait further unless the user explicitly asks you to keep
     watching (in which case, switch to the standard PR-babysitting pattern
     in `CLAUDE.md` rather than blocking this turn indefinitely).
   - **Any check failed, or merge conflicts →** do not merge **unless** the
     invocation explicitly instructed an override (e.g. "merge anyway",
     "force merge", "merge even if red"). Absent that explicit instruction,
     report the failure (which check, what it says) and stop — this mirrors
     the standing project convention of never merging red CI without
     explicit sign-off.
   - If an override was given and you merge despite red CI, say so plainly
     in your final report — don't bury a red-CI merge in a routine-sounding
     summary.

6. **After merging**, there's nothing further to watch — don't subscribe to
   PR activity for an already-merged PR. If you left it unmerged (pending or
   failed without override), it's reasonable to leave the user a clear
   status rather than auto-subscribing on their behalf; only call
   `subscribe_pr_activity` if asked to keep watching.

## Output format

Report back concisely:
1. PR URL, base/head branches, and whether it was newly created or updated.
2. Final CI state at decision time (per check) and how long the poll ran.
3. The merge decision and why (merged / held for pending CI / held for red
   CI / merged anyway per explicit override) — be explicit if you merged
   despite non-green CI.
4. If scoped to a subset of the branch: what was included, what was left
   out, and why.
