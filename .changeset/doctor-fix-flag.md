---
"gitsema": minor
---

Add `gitsema index doctor --fix`: automatically backfills missing FTS5 content, rebuilds the FTS5 index, and garbage-collects orphan embeddings when those issues are detected, then re-reports index health — no need to run `index rebuild-fts`/`index backfill-fts`/`index gc` separately.
