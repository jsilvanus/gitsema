---
"gitsema": patch
---

Fix a command-injection vulnerability in `gitsema narrate`/`explain` (and the
`POST /api/v1/narrate` and `/explain` HTTP routes): the `--range`/`since`/`until`
inputs were interpolated into a shell `git log` invocation. The narrator now
spawns git without a shell and validates `--range` against a revision allowlist,
closing both the CLI and HTTP injection vectors.
