---
"gitsema": minor
---

Add a cross-cutting `--lens semantic|structural|hybrid` toggle (plus `--weight-structural <n>`) and four new structural/semantic fusion commands: `gitsema blast-radius <symbol>` ("what changes if I touch this" — structural dependents and/or semantically similar blobs), `gitsema relate <symbol>` (callers/callees plus semantically similar blobs, both lenses), `gitsema similar <symbol>` (same call/import shape and/or semantic similarity), and `gitsema unused` (symbols/files with no inbound calls/imports edges). `gitsema impact <path> --lens structural|hybrid` now reuses `blast-radius` for true structural impact analysis.
