---
"gitsema": patch
---

Postgres storage backend now probes the connection (`SELECT 1`) on first use, so a bad or unreachable `storage.metadata.url`/`GITSEMA_STORAGE_METADATA_URL` fails with an actionable error instead of an opaque driver error at the first query — mirroring the existing Qdrant connection probe. Also fixed a stale "in progress" roadmap heading and the recurring `docs/features.md` version-banner drift, now enforced by a test.
