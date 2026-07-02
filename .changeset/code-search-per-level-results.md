---
"gitsema": minor
---

`gitsema code-search` now isolates its chunk and symbol candidate pools by default, returning them as separate, independently-ranked result lists instead of one shared-cutoff merged ranking — the default `--level symbol` was combining both pools on every call, which could let a file whose best evidence was chunk-framed get crowded out by symbol-framed matches (or vice versa) purely from embedding-framing bias. Pass `--merge-levels` to opt back into the previous single merged list. The MCP `code_search` tool and Guide's `code_search` tool adopt the same per-level separation, returning a `results_by_level` object (keyed by `file`/`chunk`/`symbol`) instead of a flat `results` array when multiple levels are active — a breaking response-shape change for existing callers, both of which gained a `merge_levels` parameter to opt back into the flat shape.
