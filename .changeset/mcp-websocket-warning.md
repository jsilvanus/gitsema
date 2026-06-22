---
"gitsema": patch
---

`gitsema tools mcp --websocket` now prints a startup warning that raw WebSocket is not one of MCP's standard transports and is unlikely to work with most MCP clients/harnesses — it's kept for forward compatibility, not removed. A proper MCP Streamable HTTP transport is planned as a follow-up (see `docs/PLAN.md` Phase 117).
