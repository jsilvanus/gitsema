---
"gitsema": minor
---

Added a generic `--narrate` flag (LLM summary via the active narrator model, requires `GITSEMA_LLM_URL`) to `first-seen`, `branch-summary`, `merge-audit`, `merge-preview`, `dead-concepts`, `debt`, `doc-gap`, `security-scan`, `blame`/`semantic-blame`, `triage`, `impact`, `ownership`, `experts`, `author`, `contributor-profile`, `bisect`, `refactor-candidates`, `cherry-pick-suggest`, and `heatmap`. Also expanded `gitsema guide`'s tool coverage to `bisect`, `refactor-candidates`, `cherry-pick-suggest`, `heatmap`, `map`, `file-diff`, `lifecycle`, `cluster-change-points`, `cross-repo-similarity`, and `pr-report`, and added `gitsema setup` as a guided onboarding wizard (alias of `gitsema quickstart`) with a storage-backend selection step (sqlite/postgres/qdrant) and an optional narrator/guide model setup step.
