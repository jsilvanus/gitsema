---
"gitsema": minor
---

Removed the `tools lsp --tcp` transport entirely (previously deprecated in Phase 120 in favor of `--websocket --key`): raw TCP had no authentication mechanism at all, and nothing in the test suite exercised it. `gitsema tools lsp`/`gitsema lsp` are now stdio or `--websocket` only — use `--websocket <bind-address> --key <token>` for network-reachable LSP access.
