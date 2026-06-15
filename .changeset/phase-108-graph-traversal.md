---
"gitsema": minor
---

Add graph traversal primitives over the Phase 107 structural graph: `gitsema graph callers <symbol>` / `gitsema graph callees <symbol>` (transitive `calls` traversal, default and max depth 3), `gitsema graph neighbors <node>` (typed neighborhood, any edge kinds, configurable direction/depth), and `gitsema graph path <a> <b>` (shortest typed path between two nodes). New MCP tools `call_graph` and `graph_neighbors` expose the same traversals.
