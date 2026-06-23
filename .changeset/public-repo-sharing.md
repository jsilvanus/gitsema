---
"gitsema": minor
---

Add public repo sharing: persisted repos can now be flagged `public` (`gitsema repos visibility <repo-id> public|private`), auto-granting `read` access to non-owner callers who index an existing public repo, gated by a first-index allow-list (`auth.allowPublicAutoIndex`/`GITSEMA_PUBLIC_AUTO_INDEX`) and a per-user re-index throttle (`auth.minReindexIntervalSeconds`/`GITSEMA_MIN_REINDEX_INTERVAL_SECONDS`).
