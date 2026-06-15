---
"gitsema": minor
---

Knowledge-graph Phases 110–111: fusion + lens coverage.

- **`gitsema hotspots`** — rank files by architectural risk = co-change (temporal) × call-coupling (structural) × churn. Available as a CLI command, MCP tool, and `POST /api/v1/graph/hotspots` HTTP route, with a `--lens semantic|structural|hybrid` toggle (default hybrid) that selects which signals drive the score.
- **Cascade query planner** — a four-stage `FTS filter → vector expand → graph traversal → merge/rerank` pipeline powers the hybrid lens for query-driven fusion, surfacing structurally-adjacent code that pure semantic search misses while leaving semantic-lens output byte-for-byte unchanged.
- **Structural enrichment** — `code-review`, `triage`, `explain`, and `guide` gain `--lens`: under a structural/hybrid lens they surface grounded call-graph and co-change context (e.g. "called by N callers", "co-changes with file X 80% of the time"). The `guide` agent also gains `call_graph`, `blast_radius`, and `hotspots` tools.
- **Lens coverage sweep** — every command where more than one lens is meaningful now exposes the shared `--lens` option with consistent defaults (existing commands → semantic, graph-native → structural, fusion → hybrid) and per-hit lens labels across text/JSON output.
