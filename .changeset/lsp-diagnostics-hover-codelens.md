---
"gitsema": minor
---

LSP `textDocument/hover` now enriches its semantic matches with optional Temporal (last touch/change frequency), Risk & quality (debt/hotspot/security), and Structure (caller/callee counts) sections when their data is available. Added `textDocument/codeLens` with per-symbol "Called N× · debt X.XX" annotations, and an opt-in `gitsema tools lsp --diagnostics` flag that pushes `textDocument/publishDiagnostics` notifications for high-debt/high-hotspot-risk files on a background timer (not supported together with `--remote`).
