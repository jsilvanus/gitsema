# Multi-Tenant Auth & User Access Control — Design Plan

**Status:** draft — direction chosen, not yet built.
**Targets:** Phases 122–125 (`docs/PLAN.md` "Multi-Tenant Auth Track").
**Scope:** gitsema-side ("Semahub Layer 1") user accounts, authentication, and
a per-user / per-repo / per-branch authorization model for `gitsema tools
serve`. Explicitly **excludes** Semahub's SaaS layer (signup marketing pages,
billing, web dashboard) — those remain a separate project per
`docs/feature-ideas.md`'s existing Semahub write-up.

---

## 1. Motivation

`docs/feature-ideas.md`'s "Semahub" idea already establishes that gitsema's
remote server (`gitsema tools serve`, plus the WebSocket/Streamable HTTP MCP
transports added in Phases 116–117) is multi-tenant-*capable* at the
infrastructure level — pluggable storage backends, per-repo isolation in the
schema — but it is not yet multi-tenant at the **identity** level:

- **No concept of a user.** `GITSEMA_SERVE_KEY` is one global admin secret.
  `repo_tokens` (Phase 75) are anonymous, scoped only to a single repo ID,
  with a free-text `label` that nothing verifies (`src/core/db/schema.ts:404-410`).
- **No way for one person to hold access to more than one repo** under a
  single identity — today that's N separate tokens with no shared owner.
- **No granularity below "full access to this repo."** A valid scoped token
  can read and (via `index --remote`) write everything in its repo; there is
  no read-only tier, and no way to scope a grant to specific branches even
  though branch-level data already exists (`blob_branches` table, `--branch`
  filters on `search`/`evolution`/`debt`/etc., `src/server/routes/analysis.ts`).
- **No self-service.** Minting or revoking a token requires direct CLI/DB
  access to the server (`gitsema repos token add/revoke`,
  `src/cli/commands/repos.ts:130-196`) — i.e. operator access, not something
  a team lead can do for their own teammates.

This blocks the stated Semahub Layer-1 prerequisite ("user management ...
not yet implemented in gitsema") and is also independently useful for any
team self-hosting `gitsema tools serve` for more than one person today.

---

## 2. Current state (verified against code)

| Concern | Today | File |
|---|---|---|
| Server admin auth | Single `GITSEMA_SERVE_KEY` env var, constant-time compared | `src/server/middleware/auth.ts:36-54` |
| Per-repo tokens | `repo_tokens` table: `token_hash` (SHA-256 at rest), `token_prefix`, `repo_id`, `label`, `created_at`. 1 token → exactly 1 repo, full access, no expiry | `src/core/db/schema.ts:404-410` |
| Token CRUD | `gitsema repos token add/list/revoke` — requires local CLI/DB access to the server host | `src/cli/commands/repos.ts:126-196` |
| Request → repo resolution | `repoSessionMiddleware` resolves `req.repoId` (set by `authMiddleware` from the token) or an explicit `repoId` in the request body/query, 403s on mismatch | `src/server/middleware/repoSession.ts:18-48` |
| Branch filtering | `branch` is a free-text optional filter on `search`/`evolution`/`debt`/etc. — a query convenience, not an authorization boundary; any caller with repo access can pass any branch string | `src/server/routes/analysis.ts` (16+ routes) |
| Repo ownership | `repos` table has no owner/org column — `id`, `name`, `url`, `dbPath`, plus Phase 100's `normalizedUrl`/`clonePath`/`lastIndexedAt`/`ephemeral` | `src/core/db/schema.ts:36-52` |
| Secrets-at-rest precedent | `gitsema config set apiKey/serveKey/remoteKey ...` already stores provider/server secrets in plaintext in `.gitsema/config.json` / `~/.config/gitsema/config.json` — there is no existing OS-keychain integration anywhere in the codebase | `src/core/config/configManager.ts` |

This confirms the feature-ideas.md Design Gaps ("no `auth` command group",
"how are credentials stored locally", "team sharing") are accurate as of
today.

---

## 3. Conceptual model: three axes, same shape as the storage-backends design

Per `docs/storage-backends-plan.md`'s approach of untangling conflated
concepts, this design separates:

### Axis A — **Identity** (who is making the request?)

A `users` row. A user authenticates via **one** of: password + session,
or a long-lived API key, or a linked SSO identity — all three resolve to
the same `user_id` before any authorization check runs.

### Axis B — **Membership** (which org does this user belong to, and with what authority?)

An **org** is the unit of self-service grant authority — it answers "who
can grant repo access without the global admin key?" Every org has a
`kind`: `personal` (auto-created with its owning user, exactly one member,
forever) or `team` (created explicitly, any number of members). This
keeps "my own stuff" and "stuff I share with a team" as the same
underlying mechanism (an org repos can belong to) without forcing every
solo user through an org-creation step — see §4.2a. An `org_members` row
ties a `user_id` to an `org_id` with a role: `org_admin` (can manage
members and grant any org repo) or `member` (can only manage grants on
repos they personally own, per Axis C's `owner` role).

### Axis C — **Grant** (what can this user do, on which repo, on which branches?)

A `repo_grants` row: `user_id` × `repo_id` × `role` (`owner` / `write` /
`read`) × `branch_pattern` (nullable; `null` = all branches, otherwise an
exact branch name or glob). This **replaces** `repo_tokens`' binary
1-token-=-1-repo model with N grants per user, each independently scoped.

These three axes compose exactly like Axes A/B/C in the storage design:
*identity* is who, *membership* is "can I act on others' behalf within this
org," *grant* is "what can I actually touch."

---

## 4. Chosen direction

### 4.1 Credentials: password+session, API keys, and SSO linking — all three, same identity

Per the answered design question, gitsema should not pick just one
credential type — it should support all three against one `users` row,
because different consumers need different ones: CLI scripts want
long-lived API keys, an eventual web UI wants session cookies, and teams
with existing identity providers want SSO rather than a second password to
manage.

- **Password + session.** Passwords hashed with `node:crypto`'s built-in
  `scrypt` (no new dependency — consistent with the project's existing
  "minimal dependencies" posture and its existing use of `node:crypto` for
  token hashing in `auth.ts`). `gitsema auth login <server-url>` prompts for
  username/password over the CLI, exchanges them for a session token via a
  new `POST /api/v1/auth/login` route, and stores the session token (not the
  password) locally.
- **API keys.** A user can mint any number of named, independently
  revocable API keys (`gitsema auth token create/list/revoke`) — this is
  the `repo_tokens` mechanism's spiritual successor, but bound to a user
  identity instead of directly to a repo (the repo scoping moves to
  `repo_grants`, Axis C).
- **SSO linking (Phase C, see §5).** A `sso_identities` table maps
  `(provider, external_id) → user_id`. Linking, not replacing — a user can
  have a password, API keys, *and* a linked SSO identity simultaneously;
  any of the three authenticates the same underlying account and the same
  grants apply.
- **Local credential storage.** Following the existing precedent (config
  values like `apiKey`/`serveKey` are already stored in plaintext in
  `.gitsema/config.json` / `~/.config/gitsema/config.json` — there is no
  prior OS-keychain integration in this codebase to extend), the CLI stores
  the session token / active API key the same way, in a new
  `~/.config/gitsema/credentials.json`, written with `0o600` permissions
  (tightened relative to today's `config.json`, since this file holds a bearer
  credential rather than a model name or URL). This resolves the
  feature-ideas.md "how are credentials stored locally?" gap without
  inventing new infrastructure.
- **Session expiry.** Sessions expire after a configurable idle window
  (default 30 days, `GITSEMA_SESSION_TTL_DAYS`), refreshed on use. API keys
  do not expire by default but are independently revocable; an optional
  `--expires <duration>` on `auth token create` sets a hard expiry for
  keys that should be temporary (e.g. CI). This mirrors how `repo_tokens`
  already had no expiry — keeping that default for keys avoids breaking
  the common "mint once, use in CI forever" case while giving sessions (which
  are more likely to be entered on a shared/laptop) a default lifetime.

### 4.2a Personal groups: every user is also a one-member org

Per the answered design question, account creation and org creation are
fused for the common case: when a user is created, the server (if enabled)
automatically creates a `kind: 'personal'` org for them and makes them its
sole, permanent `org_admin`. This gives every user a place to own repos
without first having to think about orgs — the same shape GitHub/GitLab
use for "your personal namespace vs. an organization namespace."

- **Server config gate.** Controlled by a new `auth.personalGroups` config
  key (`GITSEMA_PERSONAL_GROUPS` env var override, following the existing
  `storage.*`/`GITSEMA_STORAGE_*` precedent for boolean feature toggles),
  **default `true`** per the answered question — a freshly configured
  server creates personal groups out of the box, with no extra setup
  required to get the GitHub-style behavior. Operators who want
  strictly-org-managed repos (e.g. a server provisioned entirely by an
  external admin tool) can set it `false`; existing personal groups aren't
  retroactively deleted if the flag is later flipped off, but new users
  stop getting one.
- **Invariant: exactly one member, forever.** A `kind: 'personal'` org's
  `org_members` row count is fixed at 1 and is enforced at the route layer
  (`gitsema orgs members add` rejects any target org with `kind =
  'personal'`, regardless of caller role) — per the answered design
  question, a personal group never becomes a team. A user who wants to
  share access creates or uses a `kind: 'team'` org instead; this keeps the
  personal/team distinction load-bearing rather than cosmetic.
- **Default repo placement.** Per the answered design question, a repo
  created with no explicit org/owner (e.g. `gitsema index --remote` with no
  `--org` flag) defaults to the creating user's personal group when
  `auth.personalGroups` is enabled, rather than landing at `org_id = NULL`
  as it does today. If the flag is disabled server-wide, today's `org_id =
  NULL` behavior is unchanged. This means most solo users never need to
  touch `gitsema orgs`/`gitsema repos grant` at all — they get an owned,
  private-by-default repo automatically.
- **Moving a repo between orgs.** Per the answered design question, a repo
  must be movable between its personal group and a team org (and between
  team orgs) after creation — e.g. "I prototyped this solo, now my team
  wants it." `gitsema repos move-to-org <repo-id> <org>` updates `repos.org_id`
  directly; this only changes which org's `org_admin`s get blanket access —
  any individual `repo_grants` rows already issued on that repo (to
  specific users, regardless of org) are untouched by the move, since grants
  are keyed by `(user_id, repo_id)`, not by org. Only the repo's current
  owner (or a `org_admin` of its *current* org) may move it; landing in the
  destination org does not require that org's admin to approve the move
  (consistent with "any owner can self-service," §4.2) but the move is
  recorded in the Phase D audit log once that phase exists, since
  org-membership changes that affect access are exactly the kind of event
  worth auditing.

### 4.2 Authorization: per-user, per-repo, per-branch grants, with org-scoped self-service

- `orgs` gains a `kind` column (`personal` | `team`); `repos` gains a
  nullable `org_id` column. Existing repos (added before this feature
  ships) keep `org_id = NULL` and remain reachable only via
  `GITSEMA_SERVE_KEY` or pre-existing `repo_tokens` rows until an admin (or
  the repo's de-facto owner) moves them into an org (§4.2a's
  `gitsema repos move-to-org`, which also serves as the one-time migration
  path) — nothing breaks on upgrade, but new user-grant-based access is
  opt-in per repo until moved.
- `repo_grants(user_id, repo_id, role, branch_pattern)` is the source of
  truth for what a given user can do. `role` gates the HTTP verb class
  (`read` → GET-shaped analysis/search routes; `write` → indexing/grant
  routes; `owner` → write + can manage grants on that repo without being an
  `org_admin`). `branch_pattern` intersects with the existing `branch` query
  param: if a user's only grant for a repo is `branch_pattern: 'main'`, a
  request for `branch=feature/x` 403s; a request with no `branch` specified
  is treated as "all branches *this user* can see," i.e. the search/analysis
  routes get an additional implicit `branch IN (<union of this user's
  granted patterns>)` filter rather than defaulting to all-branches. This
  requires extending the branch filter plumbing (`vectorSearch`,
  `src/server/routes/analysis.ts`) to accept a *set* of branches, not just
  one string — the single biggest implementation-surface item in this
  design, since ~16 routes currently take a single optional `branch: string`.
- **Self-service within an org** (per the answered design question): an
  `org_admin` can grant/revoke any repo belonging to their org; any user
  holding `owner` on a specific repo can grant/revoke *that repo* (any
  branch subset, any role up to their own) to other org members, without
  needing `org_admin` or the global `GITSEMA_SERVE_KEY`. The global key
  remains a break-glass superadmin path (creating the first org, recovering
  a lockout) but stops being required for routine team-membership changes.
- `repo_tokens` (today's mechanism) is **not removed**. It keeps working
  exactly as today — full access, no identity, no branch scoping — and gets
  a row in `docs/deprecations.md` §2 (legacy, no warning, no removal date)
  once `repo_grants` ships, the same treatment already given to
  `--dump`/`--html`/`--format`. This avoids a breaking migration for
  existing self-hosted deployments that don't need per-user grants.

### 4.3 New CLI surface (`gitsema auth` + `gitsema users` + repo grant subcommands)

```
gitsema auth login <server-url>            # prompts username/password, stores session
gitsema auth login <server-url> --sso <provider>   # Phase C
gitsema auth logout
gitsema auth token create [--label] [--expires <duration>]
gitsema auth token list
gitsema auth token revoke <prefix>
gitsema auth whoami

gitsema orgs create <name>                 # always kind=team; superadmin (bootstrap) or existing org_admin
gitsema orgs members add/remove <org> <username> [--role org_admin|member]   # rejected on kind=personal orgs

gitsema repos grant <repo-id> <username> --role read|write|owner [--branch <pattern>]
gitsema repos grants list <repo-id>
gitsema repos revoke <repo-id> <username>
gitsema repos move-to-org <repo-id> <org>   # works personal->team, team->personal (back to owner), team->team

gitsema users create <username> --org <org> [--role org_admin|member]   # org_admin only; also provisions <username>'s personal group if auth.personalGroups is enabled
gitsema users list --org <org>

gitsema config set auth.personalGroups true|false   # server-side toggle, default true
```

This is additive — none of today's `gitsema repos *`/`gitsema config *`
commands change shape; `repos token *` keeps working per §4.2.

---

## 5. Phased implementation plan

### Phase A — Identity & credentials core (~600–800 LOC)

- New tables: `users` (id, username unique, password_hash, password_salt,
  created_at), `sessions` (session_token_hash, user_id, created_at,
  expires_at, last_seen_at), `api_keys` (key_hash, key_prefix, user_id,
  label, created_at, expires_at nullable, revoked_at nullable).
- `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`,
  `POST /api/v1/auth/tokens` (+ list/revoke) HTTP routes.
- `authMiddleware` extended to resolve **either** the existing
  `GITSEMA_SERVE_KEY`/`repo_tokens` path (unchanged) **or** a session/API-key
  bearer token to a `req.userId`, trying user-credential resolution first,
  falling back to the legacy paths so both work simultaneously.
- CLI: `gitsema auth login/logout/token create/list/revoke/whoami`,
  credential storage in `~/.config/gitsema/credentials.json` (0o600).
- Tests: password hashing round-trip, session expiry, API key revocation,
  dual-auth-path precedence (user credential vs. legacy token on the same
  request).
- No authorization changes yet — a logged-in user with no grants can do
  nothing beyond `whoami` until Phase B ships; this phase is purely identity
  and credential plumbing, deployable independently.
- **No personal groups yet** — `orgs` doesn't exist until Phase B, so user
  creation in Phase A does not provision a personal group. Phase B's
  migration backfills one `kind: 'personal'` org per pre-existing user when
  `auth.personalGroups` is enabled at upgrade time (see Phase B below).

### Phase B — Orgs, personal groups, repo/branch grants, self-service (~850–1100 LOC)

- New tables: `orgs` (id, name, **kind**: `personal`\|`team`, created_at),
  `org_members` (org_id, user_id, role, joined_at), `repo_grants` (id,
  user_id, repo_id, role, branch_pattern nullable, granted_by, created_at).
  `repos` gains nullable `org_id`.
- New config key `auth.personalGroups` (`GITSEMA_PERSONAL_GROUPS` env
  override), default `true` (§4.2a).
- User-creation path (both the new `gitsema users create` and Phase A's
  already-shipped account creation, retrofitted) provisions a `kind:
  'personal'` org + a sole `org_admin` `org_members` row for that user
  whenever `auth.personalGroups` is enabled at creation time. A one-time
  migration backfills a personal org for every pre-existing `users` row
  when an upgrade first enables the flag.
- Route-layer invariant: any `orgs members add/remove` targeting a `kind:
  'personal'` org 403s unconditionally (§4.2a) — checked before role
  checks, since no role should be able to override this.
- Default org resolution: when a repo is created/registered with no
  explicit org, resolve to the creating user's personal org if
  `auth.personalGroups` is enabled, else `org_id = NULL` (today's behavior).
- Authorization middleware: resolve `req.userId` → look up `repo_grants`
  for the requested `repoId`; gate by `role` (read/write/owner) per route
  class; intersect/union `branch_pattern`s against the request's `branch`
  parameter (or inject the implicit branch-set filter when none is given).
- Extend the ~16 routes in `src/server/routes/analysis.ts` (plus `search.ts`,
  `evolution.ts`, `graph.ts`) and the underlying `vectorSearch`/temporal
  query functions to accept `branch: string | string[]` rather than a single
  optional string — the largest mechanical change in this design, but
  additive (single-string callers keep working unchanged).
- CLI: `gitsema orgs create/members add/remove`, `gitsema repos
  grant/grants-list/revoke/move-to-org`, `gitsema users create/list`,
  `gitsema config set auth.personalGroups`.
- `docs/deprecations.md`: add `repo_tokens`/`gitsema repos token *` as a §2
  legacy (no-warning) mechanism once this phase ships.
- Tests: grant resolution (role gating, branch intersection, org-admin vs.
  repo-owner self-service paths, 403 on out-of-grant branch requests),
  personal-group invariant (member-add rejection, exactly-one-row
  enforcement), `move-to-org` (grants survive the move, only current
  owner/org_admin may initiate it), migration safety (pre-existing `org_id
  = NULL` repos remain reachable via legacy auth only until moved;
  pre-existing users get a personal org backfilled exactly once).

### Phase C — SSO/OIDC linking (~400–600 LOC, depends on Phase A)

- New table: `sso_identities` (provider, external_id, user_id, linked_at).
- `gitsema auth login <server-url> --sso <provider>`: device-code-style
  flow — CLI prints a URL + code, user completes the OIDC flow in a
  browser, server links the resulting external identity to (an existing or
  newly created) `users` row and returns a session token to the polling CLI.
- Requires choosing an OIDC client library (new dependency — first one
  introduced by this design; flagged explicitly since `CLAUDE.md` favors
  minimal deps) and a provider allowlist config
  (`GITSEMA_SSO_PROVIDERS`/per-provider client ID+secret).
- Out of scope for v1: provisioning users *only* via SSO with no local
  password fallback — linking augments Phase A's password/API-key identity,
  it does not replace it, so a superadmin always has a non-SSO recovery
  path.

### Phase D — Audit log (~150–250 LOC, can slip independently)

- `audit_log` table: actor `user_id`, action (`grant.create`,
  `grant.revoke`, `token.create`, `token.revoke`, `login.success`,
  `login.failure`, `org.member.add`), target, timestamp.
- `gitsema audit log [--org <org>] [--repo <repo-id>]` CLI to query it.
  `org.repo.moved` (§4.2a's `move-to-org`) is one of the logged actions.
- Lowest priority of the four — nothing in Phases A–C depends on it, and
  the feature-ideas.md Semahub write-up only asked for it as a Design Gap,
  not a hard requirement. Reasonable to schedule after seeing real usage of
  Phases A–C rather than guessing at the right granularity now.

**Total estimated effort:** ~2000–2700 LOC across four phases (Phase B grew
by ~150 LOC for personal-group provisioning/invariant-enforcement/
`move-to-org` relative to the original estimate), roughly in line with the
storage-backends design's three-phase sizing.

---

## 6. Remaining open questions

These are left open deliberately rather than answered speculatively:

- **Branch-pattern syntax.** This design assumes exact-match-or-glob
  (`feature/*`) for `branch_pattern`, mirroring `--exclude`/`--include-glob`'s
  existing substring/glob conventions elsewhere in the CLI — but the precise
  glob dialect (full glob vs. simple `*` wildcard vs. regex) isn't pinned
  down. Should be settled when Phase B's grant CLI is actually implemented,
  by checking what `--include-glob` (`src/cli/commands/index.ts`) already
  uses for consistency, not invented fresh.
- **Default role for a repo's creator.** When a user-owned org creates a
  new repo (via `index --remote` against a server with this auth model
  active), should they automatically get an `owner` grant, or must an
  org_admin grant it explicitly? Leaning toward automatic-owner-on-create
  for usability, but this wasn't asked about explicitly and affects the
  Phase B CLI/route wiring, so it's flagged rather than assumed.
- **Rate limiting and quota per user/org**, as opposed to today's per-IP
  `buildRateLimiter()` — explicitly out of scope for Phases A–D (it's listed
  as Semahub Layer-2 billing/quota territory in feature-ideas.md), but worth
  a one-line note here so a future reader doesn't assume per-user quotas
  exist once this design ships.
- **Web UI session/cookie specifics** (CSRF protection, cookie flags) are
  deferred until a web UI consumer actually exists — Phase A's session
  token is designed to be transport-agnostic (a bearer token good for both
  CLI and a future browser client) rather than a cookie, so this doesn't
  block Phase A, but CSRF hardening should be revisited if/when a
  browser-based client is built.
- **Personal-group lifecycle on user deletion/rename.** If a user account
  is deleted, what happens to repos still parked in their personal group
  (orphaned, transferred to a designated org, blocked until manually moved
  via `move-to-org`)? And if a username changes, does the personal org's
  display name follow it automatically? Neither was asked about explicitly;
  blocking-deletion-until-moved is the safest default (mirrors most "can't
  delete a non-empty namespace" precedents elsewhere) but should be
  confirmed before Phase B's user-deletion path (not yet designed here) ships.
