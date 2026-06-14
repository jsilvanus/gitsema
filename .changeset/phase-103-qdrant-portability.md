---
"gitsema": minor
---

Add a Qdrant storage backend (`storage.backend=qdrant`, `storage.vectors.url=http://...` + a Postgres companion via `storage.metadata.url`), and make `gitsema index` write to the Postgres and Qdrant backends (previously read-only). Add `gitsema storage migrate --to <backend> [options]` to copy an existing index into another backend (sqlite/postgres/qdrant), and extend `gitsema doctor`/`gitsema status` to report backend/scope/location and cross-store row counts for postgres/qdrant profiles.
