---
"gitsema": patch
---

Internal hardening and de-duplication: Postgres and Qdrant vector backends now
share one re-ranking implementation; the narrator providers share their
redaction/disabled-mode prologue; Postgres and Qdrant connections are probed
once on first use so a bad URL fails with a clear, config-pointing error
instead of an opaque connection error at first query.
