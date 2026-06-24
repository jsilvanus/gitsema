---
"gitsema": patch
---

Deprecate `gitsema index backfill-fts` (and its existing top-level alias `gitsema backfill-fts`) in favor of `gitsema index rebuild-fts`. No index database predating Phase 11 remains in active use, so the Git-refetch behavior `backfill-fts` provided is no longer needed; both commands print a deprecation warning but keep working.
