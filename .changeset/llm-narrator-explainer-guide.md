---
"gitsema": minor
---

New LLM narrator, explainer, and agentic guide (schema v22). `gitsema narrate` and `gitsema explain <topic>` return raw commit evidence by default (no network calls) and generate LLM prose with `--narrate` once a narrator model is configured via `gitsema models add <name> --narrator --http-url <url> --activate`. `gitsema guide [question]` answers questions about your repository with a real tool-calling agent loop (repo stats, recent commits, narrate/explain evidence, semantic search), supports multi-turn `--interactive` mode, and redacts secrets from every payload sent to the LLM. Also exposed as MCP tools (`narrate_repo`, `explain_issue_or_error`) and HTTP routes (`/api/v1/narrate`, `/explain`, `/guide/chat`).
