---
"gitsema": minor
---

LSP `textDocument/definition` and `textDocument/references` now resolve structurally first when the knowledge graph (`gitsema graph build`) is built, returning exact matches instead of approximate semantic/text results (fallback results are now tagged `tags: ['fallback']`). Added three new LSP methods backed by the same graph: `textDocument/prepareCallHierarchy`, `callHierarchy/incomingCalls`, and `callHierarchy/outgoingCalls`, advertised via a new `callHierarchyProvider: true` capability.
