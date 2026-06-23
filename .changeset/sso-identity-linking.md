---
"gitsema": minor
---

Adds SSO/OIDC identity linking (Phase 124 of the multi-tenant auth track): a user can have an external `(provider, externalId)` identity linked alongside their password/API keys, all resolving to the same account. Providers must be explicitly allowlisted via `GITSEMA_SSO_PROVIDERS`. New operator CLI: `gitsema auth sso link/unlink/list`. New self-service HTTP routes: `GET /api/v1/auth/sso` and `DELETE /api/v1/auth/sso/:provider/:externalId`. The live browser-based OIDC login flow is not yet implemented — linking an identity is currently an operator action.
