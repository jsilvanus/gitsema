# Code Review 11 — Multi-Tenant Auth, Public Repo Sharing, Locked-Model-Set, and the Interface Parity Track

This review reflects the repository state at **v0.97.0** (schema **v32**, **1572 passing / 22 skipped / 0 failing**, `pnpm build` clean), covering the **97 commits** landed since [review10](review10.md) (branch point `e589198`). Scope per the repo's review convention: assess everything since the last review, i.e.:

- **review10 close-out** (Phase 119–121): verification that all eight review10 improvement items were actually fixed (network-transport resource bounds, `hotspots` `topK` cap, shell-interpolation cleanup, `--tcp` deprecation, `displayName` index, `esc()` alignment, `cycles.ts` recursion guard).
- **Multi-Tenant Auth Track** (Phases 122–125): identity & credentials core (`users`/`sessions`/`api_keys`), orgs + personal groups + per-repo/branch grants, SSO/OIDC identity linking, and an identity/authorization audit log.
- **Public Repo Sharing Track** (Phases 126–127): repo visibility flag, attach-as-reader auto-grants, first-index gate, refresh throttle.
- **Locked-Model-Set Track** (Phases 128–130): multi-profile embedding serving, admin-gated enabled sets, request-scoped BYOK for narrator/guide.
- **Cleanup + Interface Parity Track** (Phases 131–148): `index doctor --fix` fix-registry, audit-coverage enforcement, and the large per-command MCP/HTTP flag-parity push that closes the CLI-only exposure gap for search, code-search, evolution, hotspots, author, workflow, narrate/explain, guide, watch, the graph family, and the remaining zero-exposure commands (bisect, refactor-candidates, lifecycle, cherry-pick, file-diff, pr-report, regression-gate, code-review, heatmap, map).

Methodology: `pnpm install --frozen-lockfile && pnpm build && pnpm test` (1572 passed / 22 skipped, build exit 0) run independently; then three focused source audits — the new auth/authorization surface (identity, grants, route enforcement), the newly network-exposed Phase 147/148 command surface (git-touching sinks reachable over MCP/HTTP for the first time), and a review10 finding-by-finding close-out — each citing exact `file:line` against current source. The two highest-severity claims below were **reproduced with a runnable PoC / traced end-to-end from the network entry point to the sink**, not inferred from the code shape.

---

## 1) Executive assessment

review10's debt is genuinely and completely cleared. All eight improvement items were independently re-verified against current source (not trusted from commit messages): both `WebSocketServer` instances now set `maxPayload` and go through a `ConnectionLimiter`, the Streamable HTTP listener enforces `MAX_BODY_BYTES` and a concurrent-session cap with a 503, `GITSEMA_WEBSOCKET_KEY`/`GITSEMA_MCP_HTTP_KEY` env fallbacks and a non-loopback-without-`--key` warning both exist, `hotspots.topK` is `.max(500)`-clamped on the HTTP route and MCP tool, `regressionGate.ts`/`codeReview.ts` now spawn `git` via `execFileSync` array form gated through `isSafeGitRange`, `graph_nodes.display_name` is indexed, `esc()` quote-escapes, and `cycles.ts` is now iterative with an explicit stack. This is a clean close-out (§5).

The team's self-reporting discipline — a standout in review10 — held up again and is, if anything, better: **every deviation this cycle is documented in `PLAN.md` before a reviewer finds it.** The single most important gap in the whole auth track (grants defined but not enforced on read routes, §2) is disclosed verbatim as "Phase 123 deviation #1." That honesty is genuinely valuable and rare — but it does not change the security posture, and a reviewer's job is to state the posture plainly regardless of how well it's disclosed.

Two findings dominate this cycle, both a direct consequence of the two big themes (auth, and network-exposing previously-CLI-only commands):

1. **A network-reachable git *argument*-injection sink survives — arbitrary file overwrite, PoC-confirmed (HIGH, §2.1).** review9/review10 fixed the *shell-string* form of git command injection (`execSync(\`git … ${x}\`)` → `execFileSync('git', [...])`). But `execFileSync` array form is only safe against *shell* metacharacters — it does **not** stop an argument that begins with `-` from being parsed as a git *flag*. `resolveRefToTimestamp()` (`src/core/search/clustering/clustering.ts:574`) runs `git log -1 --format=%ct <ref>` with `<ref>` taken verbatim from the `good_ref`/`bad_ref` fields of the `semantic_bisect` MCP tool (`src/mcp/tools/insights.ts:42-43`) and the HTTP `triage` bundle (`src/server/routes/analysis.ts:764`) — both newly network-exposed by Phase 148, neither validated. Passing `good_ref: "--output=/path/to/file"` makes `git log` write to an attacker-chosen path. I reproduced this end-to-end (§2.1). This is the same injection *class* review9 called Critical, re-entering through the exact door Phase 148 just opened, because the fix was applied as "stop using a shell" rather than "validate the ref" at this call site.
2. **The Multi-Tenant Auth Track ships authentication, but not authorization on the data surface (HIGH, architectural, §2.2).** Phases 122–125 built a complete, well-factored identity/grant/audit model — `users`/`sessions`/`api_keys` (scrypt, SHA-256-at-rest, timing-safe), orgs + personal groups, `repo_grants` with branch-glob scoping, `resolveUserRepoAccess`, and an audit log. But `resolveUserRepoAccess` is called from exactly **two** route files (`remote.ts`, `orgs.ts`) — the index/register path and the grant-management endpoints themselves. **None** of the ~16 read/search/analysis/evolution/graph/insights routes call it. `repoSessionMiddleware` (`src/server/middleware/repoSession.ts`) resolves any `repoId` a caller names to that repo's index DB and serves it with no grant check tying `req.userId` to `repoId`. Net effect: on a default `tools serve` (no `GITSEMA_SERVE_KEY`) any network client can read any persisted repo's full indexed content — including `private`-flagged ones — by naming its `repoId`; and any authenticated user can read every other user's repos. The grant model is real, tested, and inert on the surface it was built to protect.

Two lower findings round it out: BYOK's request-supplied endpoint URL is an unguarded SSRF vector on a shared server (§3.1), and the same missing-`--` git hygiene as §2.1 recurs at a handful of lower-impact call sites (§3.2).

Priority order: reject leading-`-` refs / add `--` end-of-options at the git call sites (§2.1) → decide and enforce the read-route authorization story (§2.2) → gate/allowlist BYOK endpoints for shared deployments (§3.1) → systemic `--` hygiene sweep (§3.2).

---

## 2) High-severity findings

### 2.1 Network-reachable git argument injection → arbitrary file overwrite (HIGH — PoC-confirmed)

**Sink:** `src/core/search/clustering/clustering.ts:574`
```ts
const out = execFileSync('git', ['log', '-1', '--format=%ct', ref], { cwd: repoPath, ... })
```
`ref` is passed straight through from callers with no leading-dash rejection and no `--` end-of-options separator. `execFileSync` (no shell) defeats `;`, `|`, `$()` — but **not** git's own option parsing: any `ref` beginning with `-` is parsed as a flag.

**Reach:** `resolveRefToTimestamp(ref)` ← `computeSemanticBisect(good_ref, bad_ref, …)` (`src/core/search/semanticBisect.ts:97-98`, no validation) ← two network entry points, both added by Phase 148:
- MCP tool `semantic_bisect` — `good_ref`/`bad_ref` are bare `z.string()` with no refinement (`src/mcp/tools/insights.ts:42-43`).
- HTTP `triage` bundle — `sections.bisect = computeSemanticBisect(…, ref1, ref2, …)` (`src/server/routes/analysis.ts:764`).

`resolveRefToTimestamp` first tries `new Date(ref)`; `new Date("--output=/tmp/x")` is `Invalid Date`, so it falls through to the git call.

**PoC (reproduced in this review):** invoking the exact real argv shape
```
git log -1 --format=%ct --output=pwned.txt
```
in a scratch repo created and truncated `pwned.txt`. `git log --output=<file>` is a documented flag; with no explicit commit it defaults to `HEAD`, so the missing positional doesn't save us. An attacker who can call `semantic_bisect` (or POST to `triage`) with `good_ref: "--output=<path>"` overwrites any file the server process can write — a destructive-write / integrity primitive, not merely a read.

**Fix:** at minimum reject refs matching `/^-/` before the git call (the `narrator.ts` fix already established `isSafeGitRange()` for exactly this — reuse it here); better, also pass `--` before positional refs so git can never treat a value as a flag. This is the load-bearing lesson from the review9/10 injection line: the durable fix is *validate the ref*, applied at every git call site, not *stop using a shell* applied one site at a time.

### 2.2 Authorization model is defined but not enforced on read/data routes (HIGH — architectural)

The Multi-Tenant Auth Track (Phases 122–125) is well-built in isolation: `src/core/auth/identity.ts` (scrypt password hashing, session + API-key tokens SHA-256-hashed at rest, `timingSafeEqual` comparison), `src/core/auth/grants.ts` (`resolveUserRepoAccess` with `minimatch` branch-glob scoping and `owner>write>read` ranking), `src/core/auth/orgs.ts`, and `src/core/auth/auditLog.ts` (never-throws, no FK by design). All unit-tested.

The gap is wiring. `grep -rln resolveUserRepoAccess src/server` returns only `remote.ts` and `orgs.ts`:
- `remote.ts` uses it for the index/register + public-repo auto-grant path.
- `orgs.ts` uses it to authorize grant management.

`authMiddleware` (`src/server/middleware/auth.ts`) resolves a credential to `req.userId` and **stops there** — its own docstring says "No authorization decisions are made here." `repoSessionMiddleware` (`src/server/middleware/repoSession.ts:18-48`) then takes any `repoId` from the body/query, opens that repo's DB, and makes it active — with no call to `resolveUserRepoAccess`, no `req.userId`→`repoId` check, and no consultation of the Phase 126 `visibility`/`owner_user_id` columns. Every search/analysis/evolution/graph/insights route mounted behind it therefore serves any named repo to any caller.

Concretely, on the deployment shapes the track itself targets:
- **Default `tools serve` (no `GITSEMA_SERVE_KEY`):** `authMiddleware` is a documented no-op → any unauthenticated network client reads any persisted repo's indexed content, `private` included, by naming its `repoId`.
- **Multi-user server:** any user with a valid session/API key reads every other user's repos — the per-user/per-branch grant model that is the entire point of the track is bypassed on the data surface.

This is honestly disclosed as "Phase 123 deviation #1" (`PLAN.md`: "the ~16 pre-existing analysis/search/evolution/graph HTTP routes were **not** retrofitted to call `resolveUserRepoAccess`… the `branch: string → string｜string[]` plumbing did not happen either"). The disclosure is exemplary; the consequence is that the auth track currently delivers *authentication* (who are you) without *authorization* (what may you read) on the routes that return repo content. Until the read routes call `resolveUserRepoAccess`/consult `visibility`, the new tables provide accountability (audit log) and credential management, but not access control over data — which is the property their existence implies.

**Fix (scope decision needed, hence the honest deviation):** the minimum viable enforcement is a middleware after `repoSessionMiddleware` that, when `req.userId` is set (or always, when the server is in multi-tenant mode), requires `roleSatisfies(resolveUserRepoAccess(userId, repoId, branch), 'read')` unless the repo is `visibility='public'`. The `branch: string → string[]` filter plumbing the deviation flags is a larger follow-on, but a repo-level (branch-agnostic) read gate closes the "read any private repo by ID" hole without it, and can ship first.

---

## 3) Medium / low findings

### 3.1 BYOK endpoint URL is an unguarded SSRF vector on shared servers (Medium)

Phase 130's BYOK threads a request-scoped `byok.http_url` through `resolveNarratorProvider`/`resolveGuideConfig` (`src/core/narrator/resolveNarrator.ts:188-198`) and uses it verbatim as the endpoint the **server** calls, on the network-facing `POST /api/v1/narrate`, `/explain`, and `/guide/chat` routes (`src/server/routes/{narrator,guide}.ts`). There is no scheme check, no allowlist, and no loopback/link-local block. On a shared `tools serve`, an authenticated caller can set `byok.http_url` to `http://169.254.169.254/…` or an internal service and make the server issue requests there — a classic SSRF. It is partly by-design ("bring your own endpoint"), and request-scoped/never-persisted, but there is no way for a shared-deployment operator to opt out or constrain it. **Fix:** add an optional endpoint allowlist / loopback-block (e.g. `GITSEMA_BYOK_ALLOW_HOSTS`, default-open to preserve current behavior but recommended-on for multi-tenant) and document the SSRF consideration next to the BYOK flags.

### 3.2 Same missing-`--` git hygiene at other call sites (Low)

The §2.1 root cause (user-influenced value as a git positional with no `--` guard) recurs, at lower impact because the commands lack a file-writing flag:
- `src/core/search/temporal/timeSearch.ts:166,168` — `git rev-parse --verify <value>` / `git show -s --format=%ct <hash>`, `value` from search date-filter parsing.
- `src/core/git/branchDiff.ts:13` — `git merge-base <branchA> <branchB>`, branch names from `branch_summary`/`merge_audit`.

None of these subcommands expose an `--output`-class primitive, so the blast radius is "flag confusion / error" rather than file write — but the fix is the same one-line discipline (reject leading `-`, or interpose `--`), and doing it uniformly is what stops §2.1-class findings from recurring the next time one of these commands grows a dangerous flag or a new git call site is added. Consider a single `runGit(subcommand, args, refs)` helper that always `--`-separates refs, so the safe form is the default.

### 3.3 `hotspots` `topK` is capped; the other Phase 147/148 list tools should be audited for the same (Low)

review10 §2.1's `hotspots.topK` cap (`.max(500)`) is in place. The Phase 147/148 exposure added several more list-returning tools over HTTP/MCP (`refactor_candidates`, `graph_relate`, `graph_similar`, `blast_radius`, `deps`, `co_change`); a quick sweep confirmed the graph traversal ones inherit the server-side depth clamp, but a follow-up pass to confirm every newly-exposed `top_k`/`limit` has an upper bound (not just a positive-int check) is cheap insurance against response-amplification.

---

## 4) review10 close-out verification (Phases 119–121)

All eight of review10 §7's improvement items were independently re-checked against current source:

1. **Bound the new transports — VERIFIED FIXED.** `webSocketServer.ts:23` sets `maxPayload: DEFAULT_MAX_WS_PAYLOAD` and wraps connections in a `ConnectionLimiter(DEFAULT_MAX_CONNECTIONS)`; LSP `server.ts:562` sets `maxPayload` too. `streamableHttpServer.ts` enforces `MAX_BODY_BYTES` (from `GITSEMA_MAX_BODY_SIZE`, mirroring `express.json({ limit })`) at `:37` and returns `503 Too many concurrent sessions` above `DEFAULT_MAX_CONNECTIONS` at `:78`, with correct session-map cleanup on both graceful and abrupt close.
2. **Cap `hotspots` `topK` — VERIFIED FIXED.** `src/server/routes/graph.ts:40` is `z.number().int().positive().max(500).optional().default(20)`; the MCP tool matches.
3. **Shell-interpolation cleanup — VERIFIED FIXED.** `regressionGate.ts:91,94` and `codeReview.ts:73` now use `execFileSync('git', [...])` array form (and `codeReview` gates through `isSafeGitRange`). *(Note: this fixed the shell-string class; the argument-injection class at other sites is §2.1/§3.2 — a distinct sink, not a regression of this fix.)*
4. **Non-loopback-without-`--key` warning + env fallbacks — VERIFIED FIXED.** `warnIfNonLoopbackWithoutKey()` (`src/core/util/websocket.ts:30`) exists; `tools.ts:73,80,116` read `GITSEMA_WEBSOCKET_KEY`/`GITSEMA_MCP_HTTP_KEY` as fallbacks.
5. **`--tcp` LSP transport — VERIFIED handled.** Phase 120 deprecated `tools lsp --tcp` (the unauthenticated transport review10 §3.5 flagged); `docs/deprecations.md` (Phase 121) records it, and Phase 149 schedules its removal.
6. **Index `displayName` lookups — VERIFIED FIXED.** `idx_graph_nodes_display_name` exists (`sqlite.ts:391`) and `profile.ts:380` does an indexed `findByDisplayName` instead of an `allNodes()` scan.
7. **Align client-side `esc()` — VERIFIED FIXED.** `htmlRenderer-shared.ts`'s `esc()` now escapes `"` and `'` in addition to `&`/`<`/`>`, matching the server-side escaper.
8. **`cycles.ts` recursion guard — VERIFIED FIXED.** `cycles.ts` is now an iterative DFS with an explicit stack (`:37-82`), eliminating the deep-chain stack-overflow risk; no unbounded native recursion remains.

---

## 5) What is working well (verified, keep doing this)

1. **review10 is fully closed out** — all eight items independently re-verified against source, not trusted from commit messages.
2. **Self-reported deviations remain accurate and complete.** Every `PLAN.md` deviation note checked (Phases 123, 124, 125, 128, 129, 130) matched the code, including the load-bearing §2.2 disclosure. This is the project's strongest engineering habit — preserve it, and pair each such deviation with a scheduled follow-up phase so "documented" converges to "closed."
3. **The identity/credentials core is textbook.** scrypt for passwords, SHA-256-at-rest for session/API tokens with only a display prefix kept in the clear, `timingSafeEqual` everywhere, hard + idle expiry, revoke-by-prefix scoped to the owning user. No plaintext secrets at rest, no obvious timing oracle.
4. **The audit log's never-throws + no-FK design is correct** for an accountability record that must outlive the rows it references and must never fail the primary action.
5. **All new auth SQL is parameterized** — identity, grants, orgs, SSO, and audit modules use bound statements throughout; no string-built SQL introduced this cycle.
6. **The Interface Parity Track genuinely closed the CLI-only gap** — search/code-search/evolution/hotspots/author/workflow/narrate/explain/guide/watch/graph-family and the Phase 148 long tail are now reachable over MCP/HTTP, which is real product surface. The security cost of that reach is exactly §2.1 — a reminder that the parity push and a "validate every newly-exposed input at its sink" pass must travel together.
7. **Test suite grew with the features** — 1572 passing (was 1244 at review10), build clean, schema at v32 with `docsSync` still mechanically enforcing the features.md banner.

---

## 6) Concrete improvement points (priority order)

1. **Close the git argument-injection sink (§2.1):** reject leading-`-` refs (reuse `isSafeGitRange()`) and/or `--`-separate positionals in `resolveRefToTimestamp` before either `semantic_bisect`/`triage` is exercised in the wild. *(High — network-reachable arbitrary file overwrite, PoC-confirmed.)*
2. **Decide and enforce read-route authorization (§2.2):** add a post-`repoSessionMiddleware` grant/visibility check so a `repoId` a caller names is one they may read; ship the repo-level gate first, the `branch: string[]` filter as follow-on. *(High — architectural; the auth track's stated purpose depends on it.)*
3. **Guard BYOK endpoints for shared deployments (§3.1):** optional host allowlist / loopback-block + an SSRF note by the flags. *(Medium.)*
4. **Systemic `--` git hygiene (§3.2):** a `runGit` helper that always `--`-separates refs, applied to `timeSearch.ts`/`branchDiff.ts` and adopted as the default going forward. *(Low, but it's the durable fix for the whole §2.1 class.)*
5. **Upper-bound every newly-exposed list tool's `top_k`/`limit` (§3.3).** *(Low.)*
6. **Convert the documented auth deviations into scheduled phases** (read-route enforcement, personal-org default on repo creation, backfill migration for pre-existing users, the OIDC device-code flow) so the exemplary disclosure converges to closure rather than accumulating. *(Process.)*

---

*Methodology: independent `pnpm install --frozen-lockfile && pnpm build && pnpm test` (1572 passed / 22 skipped, build exit 0); three focused source audits (new auth/authorization surface; Phase 147/148 newly-network-exposed git sinks; review10 finding-by-finding close-out), each citing exact `file:line` against current source. The §2.1 argument-injection finding was reproduced with a runnable PoC (git log `--output=` writing an arbitrary file in a scratch repo) and traced end-to-end from the `semantic_bisect` MCP schema / HTTP `triage` route to the `execFileSync` sink; the §2.2 enforcement gap was verified by confirming `resolveUserRepoAccess` is referenced in only `remote.ts`/`orgs.ts` and that `repoSessionMiddleware` performs no grant check. All eight review10 improvement items were re-verified rather than trusted from commit messages, and PLAN.md's self-reported deviations for Phases 123–130 were cross-checked against source with no discrepancies found.*
