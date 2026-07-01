---
"gitsema": minor
---

`POST /analysis/author` (HTTP API) now supports the full `gitsema author` CLI flag surface: `since`, `detail`, `includeCommits`, `hybrid`, and `bm25Weight` are wired through to the same author-attribution logic the CLI uses, plus `chunks`/`level`/`vss` are accepted for flag-surface parity (no-op, matching the CLI's own behavior for these three). Breaking change: the response shape is now `{ authors, commits? }` instead of a bare array, to carry `includeCommits` results.
