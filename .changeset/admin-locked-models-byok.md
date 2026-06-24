---
"gitsema": minor
---

Add superadmin-controlled model allow-lists and bring-your-own-key (BYOK) support. Operators can now restrict which embedding profiles or narrator/guide model configs are usable, server-wide or per-org, via `gitsema admin models list|allow|deny|reset --kind <embedding|narrator|guide> [--org <name>]`. Independently, `narrate`/`explain`/`guide` (CLI, HTTP, and MCP) accept request-scoped BYOK credentials (`--byok-http-url`/`--byok-api-key`/`--byok-model`/`--byok-max-tokens`/`--byok-temperature` and equivalent HTTP/MCP fields) that bypass the allow-list entirely and are never persisted.
