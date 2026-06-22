---
"gitsema": minor
---

Add a unified subgraph view (Phase 112) to `graph neighbors`, `graph path`, `blast-radius`, `relate`, `similar`, and `hotspots`: pass `--out html:graph.html` for an interactive force-directed graph (clicking a node shows its details and suggested follow-up commands), or `--out text`/`--out markdown:graph.md` for an ASCII tree / nested bullet list rendering, alongside each command's existing JSON and default text output.
