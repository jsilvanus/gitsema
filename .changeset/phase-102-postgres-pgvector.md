---
"gitsema": minor
---

Add a Postgres + pgvector storage backend (`storage.backend=postgres`, `storage.metadata.url=postgres://...`) as an alternative to SQLite for search, history, evolution, and other read-path commands. Keyword search defaults to `tsvector`/`ts_rank_cd`, with ParadeDB `pg_search` BM25 available as an opt-in (`storage.fts.backend=pg_search`). `gitsema index` does not yet write to this backend — that's planned for a follow-up phase.
