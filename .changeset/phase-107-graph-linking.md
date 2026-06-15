---
"gitsema": minor
---

Add `gitsema graph build`, which resolves `structural_refs`/`symbols`/`blob_commits` into a structural knowledge graph (`graph_nodes` + typed `edges`: contains, defines, imports, calls, extends, implements, references, co_change) using confidence-tier resolution for ambiguous references. New CLI commands `gitsema co-change <path>`, `gitsema deps <identifier>`, and `gitsema graph cycles` / `gitsema cycles` read from the resulting graph (schema v26).
