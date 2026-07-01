---
"gitsema": patch
---

`gitsema models add <name> --level <level>` now actually takes effect: `index start` and `search` fall back to a model's saved `--level` when no explicit `--chunker`/`--level`/`--profile` flag is passed, instead of silently ignoring it (Phase 77 Goal #4 closed).
