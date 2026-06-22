---
name: parity-check
description: Check whether the feature(s) just developed (current branch/diff, or a named tool/command) are wired into every applicable interface — CLI, REPL, LSP, Guide, MCP, HTTP — against docs/parity.md's matrix, then update that file to match reality. Use after landing a new command/tool/flag, or when asked to audit/update interface parity.
argument-hint: [optional command/tool name, e.g. "hotspots" — defaults to scanning the current diff]
---

This skill **does** edit `docs/parity.md` — that update is the deliverable,
not a side effect to ask permission for. It does not add the missing
interface wiring itself (e.g. it won't write a new MCP tool just because CLI
has one) unless the user separately asks for that; it reports gaps and
records them in the matrix/roadmap sections.

## Why this skill exists

`docs/parity.md` says it's "the single source of truth for interface
parity," and `CLAUDE.md` requires it be updated whenever "the change affects
tool availability across interfaces ... or adds/modifies command flags." In
practice this update is easy to forget right after shipping a feature —
unlike `features.md`/`README.md`, there's no obvious prompt to touch it. This
skill is the deliberate check-and-update step for exactly that gap.

## What to do

1. **Identify the feature(s) to check.**
   - If an argument names a command/tool, scope to that.
   - Otherwise, inspect the current diff (`git diff main...HEAD` or
     `git log` on the current branch, plus any recent commits not yet
     reflected in `docs/parity.md`'s "Last updated" date) to find which
     command(s)/tool(s)/flag(s) were added or changed.

2. **For each feature, check every interface it should plausibly support**,
   by reading the actual registries — not by trusting the existing table:
   - **CLI**: `src/cli/register/*.ts` / `src/cli/commands/*.ts` — is there a
     `program.command(...)` for it?
   - **REPL**: `src/cli/commands/repl.ts` (or equivalent) — REPL only ever
     supports search-shaped commands; most things legitimately don't apply.
   - **LSP**: `src/core/lsp/server.ts`'s method dispatch — only navigation/
     hover-shaped features apply here; most analysis/workflow commands
     legitimately don't.
   - **Guide**: `src/core/narrator/guideTools.ts`'s `GUIDE_TOOLS` registry —
     is there an entry calling the same underlying function?
   - **MCP**: `src/mcp/tools/*.ts` — is there a `registerTool()` call for it?
   - **HTTP**: `src/server/routes/*.ts` — is there a route calling the same
     underlying function?
   Grep for the underlying core function name (not just the command name) in
   each location — interfaces sometimes wrap it under a different label.

3. **Diff that reality against `docs/parity.md`'s Tool Parity Matrix** (§1).
   For each feature checked:
   - If the matrix row is missing, add it in the correct category group with
     accurate ✓/— per column.
   - If the matrix row exists but is wrong (claims ✓ where there's no
     wiring, or — where wiring now exists), correct it.
   - If a brand-new interface category doesn't exist yet, don't invent a
     column — flag it as a question instead of guessing.

4. **Check §2 (Flag Implementation & Coherence)** for any new flags the
   feature introduced — add rows to §2.1/§2.2 if the flag is shared/common
   or command-specific respectively, following the existing row format
   exactly (columns: Flag, Short, Type, Default, Used By, Notes).

5. **Update §3 (Interface-Specific Implementation Notes)** counts if they
   changed (e.g. "85 commands", "47 tools", "~30 endpoints", "45 tools") —
   these drift every time a command/tool/route is added and are easy to miss.

6. **Update the "Last updated" date at the top and "Document Status" line at
   the bottom** to today's date once the audit is done.

7. **Do not silently add missing wiring.** If a feature is missing from an
   interface where it plausibly belongs (e.g. a new analysis command isn't
   in Guide or MCP), record that as a real gap — add it to §6 "Roadmap:
   Closing Parity Gaps" if it isn't already tracked there, but don't write
   the MCP tool/Guide entry/HTTP route yourself unless asked.

## Output format

Report back:
1. Which feature(s) were checked.
2. What changed in `docs/parity.md` (rows added/corrected, counts updated).
3. Any genuine gaps found (feature missing from an interface it should
   plausibly support) that were added to the roadmap section — call these
   out explicitly since they're actionable follow-up work, distinct from the
   bookkeeping fixes.
