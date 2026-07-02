---
"gitsema": minor
---

The `graph` command family (`callers`, `callees`, `neighbors`, `path`, `relate`, `similar`, `unused`, `cycles`, `deps`, `co-change`, `blast-radius`) is now exposed over HTTP (`POST /api/v1/graph/*`) and MCP (`graph_path`, `graph_relate`, `graph_similar`, `graph_unused`, `cycles`, `deps`, `co_change`, `blast_radius` tools; `callers`/`callees` gained HTTP routes and reuse the existing `call_graph` MCP tool), matching the CLI's existing flag surface. `graph build` remains CLI-only — it's a mutating, truncate-and-rebuild index-maintenance operation, not a query, consistent with `index vacuum`/`gc`/`rebuild-fts`/etc.
