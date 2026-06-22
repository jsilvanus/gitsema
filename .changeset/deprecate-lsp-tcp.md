---
"gitsema": patch
---

`gitsema tools lsp --tcp` is now deprecated in favor of `--websocket --key`: raw TCP has no request framing to carry a Bearer token in, so the unauthenticated-`--tcp` gap flagged in review10 is closed by steering users to the already-authenticated WebSocket transport instead of inventing a bespoke handshake-auth protocol. `--tcp` continues to work unchanged but now prints a deprecation notice on every invocation.
