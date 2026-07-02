---
"gitsema": minor
---

`POST /api/v1/guide/chat` (HTTP API) now accepts a `lens: 'semantic'|'structural'|'hybrid'` field, mirroring CLI `gitsema guide --lens` — under `structural`/`hybrid` it biases the guide agent's tool choice toward `call_graph`/`blast_radius`/`hotspots`, identically to the CLI. Remote multi-turn/session support (an HTTP equivalent of CLI `guide --interactive`) remains a deferred, unresolved design question — see `docs/feature-ideas.md`.
