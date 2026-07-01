---
"gitsema": minor
---

`gitsema search` now returns distinct, independently-ranked result lists per search level (file/chunk/symbol/module) by default whenever two or more of `--chunks`/`--level symbol`/`--level module` are active at once — e.g. `--chunks --level symbol`, or a per-model saved-level mismatch — instead of merging every level into one shared-cutoff ranked list where a weaker level's matches could be crowded out entirely. Text output renders one labeled section per level; `--out json` emits a `resultsByLevel` object keyed by level. Pass `--merge-levels` to opt back into the previous single merged list. A single active level (the common case) is unaffected.
