---
"gitsema": patch
---

Make non-SQLite storage backends fail loudly instead of silently returning
wrong results. The Postgres and Qdrant vector backends now reject search
options they cannot honor (`allowedHashes` candidate filtering used by
boolean/negative-example search; negative-example search on Qdrant) with a
clear error, `gitsema index --file` errors on non-sqlite backends instead of
writing to an index the backend never reads, and indexing warns when
module-level (directory-centroid) embeddings are skipped on a non-sqlite
backend.
