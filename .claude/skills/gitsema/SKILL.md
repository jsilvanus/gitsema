---
name: gitsema
description: Use gitsema for semantic codebase discovery before reading or editing files. Reduces token usage by surfacing relevant files with one search instead of grepping or reading blindly.
argument-hint: [concept or task description]
---

Read `skill/gitsema-ai-assistant.md` for the full reference (commands, MCP tools, workflows, model setup).

## What to do

Before reading files or proposing changes, run semantic search to find what's relevant:

```bash
gitsema search "<concept from task>" --hybrid --level chunk --top 5
```

Then follow this sequence:

1. **Discover** — search for the concept. Read only the files that come back with score > 0.6.
2. **Orient** — if the task touches history or evolution, run `gitsema first-seen` and `gitsema evolution`.
3. **Scope** — run `gitsema impact <file>` on any file you plan to edit.
4. **Act** — propose changes grounded in what the search revealed.
5. **Summarise** — note which paths, blob hashes, and concepts informed the change.

If an argument was provided, treat it as the initial search query and start at step 1 immediately.
