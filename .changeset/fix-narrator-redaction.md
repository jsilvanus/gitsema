---
"gitsema": patch
---

Ensure secret/PII redaction is always applied before any narrator prompt is
sent to an LLM. Previously the per-result `--narrate` helpers (search,
evolution, clusters, diff, security findings, etc.) sent prompts unredacted;
redaction now happens at the shared call site so every narration path is
covered.
