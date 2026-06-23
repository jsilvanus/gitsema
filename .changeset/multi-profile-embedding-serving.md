---
"gitsema": minor
---

Add multi-profile embedding serving: a `gitsema tools serve` deployment can now offer several named embedding profiles (provider/model pairs) at once via `GITSEMA_EMBEDDING_PROFILES`/the `embeddingProfiles` config key. Repos are pinned to a profile forever at first index (`gitsema remote-index --profile <name>`), and `gitsema repos info <repo-id>` shows the pinned profile. Servers with no profiles configured behave exactly as before.
