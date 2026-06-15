---
"gitsema": minor
---

Symbols now carry stable, path-free identities: `code-search` and the LSP `documentSymbol` results show fully-qualified names with normalized signatures (e.g. `Auth.validateToken(token:string)`) for TypeScript, TSX, JavaScript, and Python. The `symbols` table gains nullable `qualified_name`, `signature`, `signature_hash`, and `parent_qualified_name` columns (schema v24); older rows remain unaffected until re-indexed.
