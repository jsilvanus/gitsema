---
"gitsema": minor
---

`gitsema tools serve` now persists cloned repos and their indexes under `GITSEMA_DATA_DIR` (default `~/.gitsema/data`) by default, reusing them on subsequent `/api/v1/remote/index` requests (fetch + incremental reindex instead of a fresh clone). The response includes a `repoId` that can be passed to search, evolution, analysis, watch, projections, narrate, explain, and guide routes to query that repo's persisted index. SSH agent forwarding lets the server re-index private repos without per-request credentials. Use `persist: false` for the legacy ephemeral behavior, and manage persisted repos with `gitsema repos list-persisted` and `gitsema repos remove <repoId> [--purge]`.
