---
"gitsema": minor
---

Add identity & credentials core for `gitsema tools serve`: user accounts with password login (`gitsema auth login/logout/whoami`) and long-lived API keys (`gitsema auth token create/list/revoke`), backed by new `users`/`sessions`/`api_keys` tables. The server's auth middleware now resolves these alongside the existing `GITSEMA_SERVE_KEY`/per-repo token mechanisms.
