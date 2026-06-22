---
"gitsema": patch
---

Extracted the duplicated `4000`-char LLM-result truncation cap (previously a separate constant in `guideTools.ts` and `llm/narrator.ts`) into a single shared `core/narrator/resultCap.ts` helper. Also refreshed `docs/feature-ideas.md` — removed LSP/MCP remote-delegation, WebSocket, structural-navigation, and diagnostics/hover ideas that shipped as Phases 113–117, and added the still-undesigned plugin-API idea.
