---
"gitsema": minor
---

Adds orgs, personal groups, and repo/branch grants (Phase 123 of the multi-tenant auth track): every user now belongs to one or more orgs (an auto-provisioned personal org, or an explicit team org with `org_admin`/`member` roles), and repo access is granted per-user via `repo_grants` (`read`/`write`/`owner`, optionally scoped to a branch glob). New CLI: `gitsema orgs create/list/members add/remove/list`, `gitsema users create/list`, and `gitsema repos grant/grants/revoke/move-to-org`. New HTTP routes under `/api/v1/orgs` and `/api/v1/repos/:repoId/{grants,move-to-org}`.
