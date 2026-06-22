---
"gitsema": patch
---

Closes out review10's remaining findings: the MCP WebSocket/Streamable HTTP listeners and the LSP TCP/WebSocket listeners now cap payload size and concurrent connections/sessions, and warn at startup when bound to a non-loopback address without a `--key` (with `GITSEMA_WEBSOCKET_KEY`/`GITSEMA_MCP_HTTP_KEY` env-var fallbacks for `--key`); `tools lsp --tcp` is documented as unauthenticated. `hotspots`' `topK` parameter is now capped at 500 on the HTTP route and MCP tool. `regression-gate`/`code-review`'s git ref handling moved from shell-interpolated `execSync` to `execFileSync` with the same git-ref allowlist used elsewhere. `resolveNode()` now uses an indexed `display_name` lookup instead of a full graph scan, the HTML viz's client-side `esc()` helper now escapes quotes to match the server-side escaper, and `gitsema cycles`' DFS no longer risks a stack overflow on very long import chains.
