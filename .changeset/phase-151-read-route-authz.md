---
"gitsema": patch
---

Security (Phase 151 / review11 §2.2): enforce repo authorization on read
routes. The multi-tenant grant model (`repo_grants` / `resolveUserRepoAccess`)
was defined but never checked on the ~16 search/analysis/evolution/graph/
insights routes, so any caller could read any repo's indexed content by naming
its `repoId`. A new `repoAuthMiddleware` now runs after `repoSessionMiddleware`
and, in multi-tenant mode, requires the caller to hold a `read` grant on the
addressed repo unless it is `public` (else 403). Multi-tenant mode is opt-in
via `GITSEMA_MULTI_TENANT` (defaulting to `GITSEMA_SERVE_KEY` presence); the
global serve key and legacy per-repo scoped tokens bypass the check, and a
default open single-dev server is unaffected. Repo-level only — per-branch
grant filtering is deferred to a follow-on phase.
