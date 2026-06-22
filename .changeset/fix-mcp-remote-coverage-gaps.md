---
"gitsema": patch
---

Fixed two gaps in `gitsema tools mcp --remote`: the `narrate_repo` and `explain_issue_or_error` tools now delegate to the remote server like every other tool (they previously always ran locally), and `--remote` now also takes effect when combined with `--websocket` or `--http` (previously only the default stdio transport honored it).
