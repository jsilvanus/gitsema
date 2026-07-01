---
"gitsema": minor
---

`POST /evolution/file` now accepts `level` (`file`/`symbol` per-symbol centroid evolution), `branch`, `model`/`textModel`/`codeModel` overrides, and `alerts` (top-N largest semantic jumps with author/commit), matching the CLI's `file-evolution` flag surface. `POST /evolution/concept` gains `branch` and model overrides, matching `evolution`/`concept-evolution`. `POST /graph/hotspots` gains `weightStructural`, matching CLI's `--weight-structural`. Branch filtering is now threaded through the core `computeEvolution()`/`computeConceptEvolution()` functions rather than being CLI-only.
