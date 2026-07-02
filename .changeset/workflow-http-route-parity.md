---
"gitsema": minor
---

The HTTP `POST /analysis/workflow` route now supports all 8 productized workflow templates that CLI `workflow run` has (`pr-review`, `incident`, `release-audit`, `onboarding`, `ownership-intel`, `arch-drift`, `knowledge-portal`, `regression-forecast`) instead of just 3, and accepts `role`/`ref` body fields (mirroring CLI `--role`/`--ref`) generally rather than gated to a single template.
