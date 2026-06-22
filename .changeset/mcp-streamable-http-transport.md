---
"gitsema": minor
---

Added `gitsema tools mcp --http <bind-address>` (e.g. `--http 0.0.0.0:4242`) — a proper MCP Streamable HTTP transport using the SDK's own `StreamableHTTPServerTransport`, listening on a fixed `/mcp` path with stateful sessions tracked via the `Mcp-Session-Id` header. `--key <token>` requires a matching `Authorization: Bearer <token>` header, same convention as `--websocket`. Unlike the non-standard `--websocket` transport (kept only for forward compatibility), Streamable HTTP is MCP's actual recommended network transport and should be preferred by clients/harnesses that need a network-reachable MCP server.
