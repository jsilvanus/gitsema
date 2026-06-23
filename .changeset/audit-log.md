---
"gitsema": minor
---

Add an identity/authorization audit log: sensitive actions (grant create/revoke, token create/revoke, login success/failure, org membership changes, repo org moves) recorded on the HTTP auth/orgs routes and queryable via `gitsema audit log [--org] [--repo] [--limit]`. Completes the Multi-Tenant Auth Track (Phases 122-125).
