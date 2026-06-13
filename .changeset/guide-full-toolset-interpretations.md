---
"gitsema": minor
---

`gitsema guide` now wires the full ~36-capability gitsema toolset (history, branch/merge, ownership, quality, diff/blame, clustering, and workflow analyses, not just the original 5) into its agentic tool-calling loop, with a dynamic system prompt built from a new per-tool interpretation registry. The same registry also drives the `narrate`/`explain` narrators and a generated "Interpreting gitsema tool results" section in the gitsema-ai-assistant skill (`pnpm gen:skill`), which now ships with the npm package. Documented Ollama setup for `narrate`/`explain`/`guide`.
