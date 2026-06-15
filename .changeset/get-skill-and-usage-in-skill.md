---
"gitsema": minor
---

Make the agent skill self-serve for tools, and expose it over MCP.

- The generated skill (`skill/gitsema-ai-assistant.md`) now documents **both** how to use each tool (description + parameters) and how to read its result, joined per tool — previously it carried only result interpretation.
- New **`get_skill`** MCP tool returns the skill document, so MCP clients can fetch gitsema's operating playbook (usage + interpretation for every tool) at the start of a session instead of having it only embedded in the guide's own prompt.
