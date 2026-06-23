---
"gitsema": minor
---

Add `gitsema index doctor --fix`: automatically backfills missing FTS5 content and garbage-collects orphan embeddings when those issues are detected, then re-reports index health — no need to run `index backfill-fts`/`index gc` separately.
