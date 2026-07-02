---
"gitsema": minor
---

The HTTP API's `clusters`, `change-points`, `author`, `impact`, `semantic-diff`, `semantic-blame`, `triage`, and `workflow` analysis routes now accept the same `model`/`textModel`/`codeModel` embedding overrides already available as `--model`/`--text-model`/`--code-model` on their CLI equivalents, via a new shared request-scoped resolver.
