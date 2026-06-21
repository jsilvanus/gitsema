---
"gitsema": minor
---

Added remote delegation for the MCP and LSP servers: `gitsema tools mcp --remote <url>` and `gitsema tools lsp --remote <url>` (with `--remote-key`/`--remote-timeout`, or `GITSEMA_REMOTE`/`GITSEMA_REMOTE_KEY`) now proxy every data-access call to a running `gitsema tools serve` instance via a new generic `POST /api/v1/protocol/:operation` route, with a startup health check that fails fast if the remote is unreachable.
