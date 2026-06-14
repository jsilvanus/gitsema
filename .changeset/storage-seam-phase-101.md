---
"gitsema": minor
---

Introduce a pluggable storage seam (Phase 101): the `MetadataStore`,
`VectorStore`, and `FtsStore` async interfaces with a SQLite-backed adapter that
preserves today's behavior, plus `storage.*` config keys and a
`project | user | named` index-scoping model. No new backend yet — this is the
groundwork for the Postgres + pgvector and Qdrant backends.
