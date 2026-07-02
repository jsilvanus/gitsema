---
"gitsema": minor
---

`POST /narrate` and `POST /explain` now accept an `evidenceOnly` field, letting HTTP callers explicitly request the same safe-by-default evidence-only mode as the CLI's `narrate`/`explain` (omitted = evidence-only, no LLM call) — both responses also gain a structured `evidence` array. `POST /explain` additionally accepts `log` (error/stack-trace context file) and `files` (search-scope glob), and both routes accept `lens`, which on `/explain` returns a `structuralContext` field (call-graph/co-change enrichment) when combined with a concrete `files` path under a `structural`/`hybrid` lens.
