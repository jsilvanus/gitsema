# Skill: gitsema AI Assistant

Use this skill when an AI coding agent needs repository-aware semantic context from `gitsema`.

## Goal

Improve coding accuracy by grounding AI changes in:

- semantic search across history
- concept evolution over time
- impact and ownership signals

## Recommended workflow

1. **Refresh index (incremental):**
   ```bash
   gitsema index
   ```
2. **Find relevant prior implementations:**
   ```bash
   gitsema search "<feature or bug phrase>" --hybrid --top 20 --explain
   ```
3. **Find historical origin and drift:**
   ```bash
   gitsema first-seen "<concept>"
   gitsema evolution "<concept>" --threshold 0.3
   ```
4. **Estimate blast radius before editing:**
   ```bash
   gitsema impact <path>
   gitsema diff <ref1> <ref2> "<concept>"
   ```
5. **Find likely reviewers/experts:**
   ```bash
   gitsema experts --top 10
   ```
6. **Create AI-ready context packet:**
   - include top semantic matches
   - include first-seen/evolution highlights
   - include impact + expert suggestions
   - attach confidence caveats when similarity is low

## Prompt template for coding agents

> Use gitsema evidence before proposing edits.  
> 1) Run semantic search for the requested change.  
> 2) Check first appearance and evolution of the concept.  
> 3) Run impact analysis on target files.  
> 4) Propose code changes that preserve existing semantic intent unless explicitly changing behavior.  
> 5) Summarize provenance (paths/commits/concepts) used to justify the patch.

## Guardrails

- Prefer `--hybrid` for mixed natural-language and keyword queries.
- Use `--branch` when analyzing non-default branch work.
- Treat `security-scan` similarity as heuristic evidence, not confirmed vulnerability findings.
- Re-run `gitsema index` after major rebases or merges before analysis.
