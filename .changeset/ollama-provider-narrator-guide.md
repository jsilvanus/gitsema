---
"gitsema": minor
---

Add `--provider ollama` to `gitsema models add <name> --narrator|--guide`, which defaults `--http-url` to `http://localhost:11434` and sends the correct `model` field to Ollama's chat API (fixing a bug where the narrator/guide HTTP path sent a hardcoded `model: "default"`, which Ollama rejects). `gitsema models add [name]` now also accepts an optional model name for embedding, narrator, and guide configs: when omitted with `--provider ollama`, gitsema lists the models available on your local Ollama server.
