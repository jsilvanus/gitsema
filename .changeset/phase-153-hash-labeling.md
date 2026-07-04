---
"gitsema": minor
---

Phase 153: Add `blob:` prefix to blob hashes in all text outputs (CLI, MCP, HTTP) so they are clearly distinguishable from commit hashes. HTML renderers now show "Blob Hash" column headers and `blob:`/`commit:` prefixes. OpenAPI `blobHash` field description updated for clarity. MCP tool interpretations for `semantic_search`, `search_history`, and `first_seen` updated to guide LLMs on hash types.
