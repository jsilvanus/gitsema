---
"gitsema": minor
---

`bisect`, `refactor-candidates`, `lifecycle`, `cherry-pick-suggest`, `file-diff`, `pr-report`, `regression-gate`, `code-review`, `map`, and `heatmap` are now available as MCP tools and `POST /api/v1/insights/*` HTTP routes, not just CLI commands — AI clients and remote callers can now reach them directly. Also fixes a pre-existing bug in `refactor-candidates`' default symbol-level scan that made it error out on any index with symbol embeddings.
