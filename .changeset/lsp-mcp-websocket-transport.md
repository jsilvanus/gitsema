---
"gitsema": minor
---

Added a WebSocket transport for both protocol servers: `gitsema tools mcp --websocket <bind-address>` and `gitsema tools lsp --websocket <bind-address>` (e.g. `--websocket 0.0.0.0:4242`) listen on fixed `/mcp`/`/lsp` paths, with `--key <token>` requiring a matching `Authorization: Bearer <token>` header. Unlike `--remote` delegation, WebSocket supports server push, so `--diagnostics` now works together with `--websocket`. gitsema does not terminate TLS — put a reverse proxy in front for `wss://`.
