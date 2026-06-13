---
"gitsema": minor
---

Add CLI-based AI tool backends (e.g. Claude Code, Codex CLI, GitHub Copilot CLI) as narrator/guide model providers, alongside the existing HTTP-based ones. Configure with `gitsema models add <name> --narrator|--guide --provider cli --cli-command <tool> [--cli-args "<args>"] [--use-mcp] --activate`; `guide --use-mcp` exposes gitsema's own MCP server to the CLI tool's agent loop, and multi-turn `-i/--interactive` sessions are kept coherent via the tool's session-resume mechanism.
