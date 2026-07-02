---
"gitsema": minor
---

The HTTP API now exposes `GET /watch` (list saved watch queries) and `DELETE /watch/:name` (remove one by name), matching the CLI's `watch list`/`watch remove` — previously only `watch add`/`watch run` had HTTP routes.
