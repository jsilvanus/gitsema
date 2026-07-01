# Feature Ideas & Design Gaps

This document tracks upcoming feature ideas that are **not yet in active development** (not in `PLAN.md`) and haven't been **fully designed** (no design file). It's a staging area for "what now?" questions and medium-term product direction.

**Last updated:** 2026-06-23 (added the public-repo-sharing throttle/policy-extraction idea, found during the Phase 126/127 `/simplify` review; added audit log coverage enforcement idea, found during the Phase 125 `/simplify` review; refined public-repo sharing's access-control half into `docs/public-repo-sharing-plan.md` and the superadmin-locked model set idea into `docs/locked-model-set-plan.md`; kept cross-repo blob dedup as an open idea)
**Audience:** Developers considering next phases; product planning

> **Note:** As of this update, the LSP/MCP remote-delegation foundation this
> document used to describe as undesigned (remote delegation, WebSocket
> transport, structural navigation, diagnostics/code lens, hover enrichment)
> has shipped as Phases 113–117 in `docs/PLAN.md` (see the "LSP & MCP
> Fleshout Track"). Those sections were removed from here; this file now
> tracks only what's genuinely still just an idea.

---

## Semahub: Hosted Semantic Indexing Service (Built on Self-Hosted Remote MCP)

### Problem
- Developers want semantic indexing as a service (SaaS)
- Running gitsema locally requires embedding models, GPU, storage infrastructure
- Self-hosted teams want centralized index server without managing their own
- Multi-repo indexing is expensive; shared service amortizes embedding model cost

### Vision: "Semahub"
A **managed platform** built on top of the self-hosted remote MCP foundation:
- Users register repos and Semahub handles indexing
- No infrastructure: no embedding models to run, no storage to manage
- Access indexes via CLI, LSP, MCP, or web dashboard
- Billing based on repo size, indexing compute, query volume

**Key point:** Semahub is NOT a separate architecture—it's **self-hosted remote MCP + user management + hosted storage.**

### Architecture (Layered on Self-Hosted Remote MCP)

**Layer 1: Self-Hosted Remote MCP — ✅ already complete (Phases 100–117)**
```
┌──────────────────────────────────┐
│  gitsema tools mcp --http/--websocket │ ← MCP over Streamable HTTP / WebSocket
│     (auth via Bearer token)       │
└──────────────┬───────────────────┘
               │
        ┌──────▼──────┐
        │ gitsema HTTP │ ← Multi-tenant HTTP API (Phase 101+)
        │   (Phase 101+)│   User isolation, auth, quotas
        └──────┬───────┘
               │
        ┌──────▼──────────────────┐
        │ Pluggable storage        │ ← sqlite / postgres+pgvector / qdrant
        │ (Phases 101–103)         │   (GITSEMA_STORAGE_* / storage.* config)
        └──────────────────────────┘
```

**Layer 2: Semahub (Built on Layer 1) — not started**
```
┌──────────────────────────────────┐
│   Semahub Web UI & Services      │  ← Separate project (Node/Python)
│   - User auth (signup/login)     │
│   - Repo registry & management   │
│   - Billing/subscriptions        │
│   - Job queue & orchestration    │
│   - Index storage (S3/MinIO)     │
│   Database: PostgreSQL           │
└──────────────┬───────────────────┘
               │ (delegates to Layer 1)
    ┌──────────┴──────────┐
    │                     │
┌───▼────────────┐  ┌────▼────────────┐
│ gitsema serve  │  │ gitsema serve   │
│ + auth layer   │  │ + auth layer    │  ← Layer 1: Self-hosted MCP foundation
│ + MCP HTTP     │  │ + MCP HTTP      │
└───┬────────────┘  └────┬────────────┘
    │                     │
    └──────────┬──────────┘
               │
        ┌──────▼──────────┐
        │ S3/MinIO         │ ← Managed object storage (Semahub-specific)
        │ (index storage)  │
        └──────────────────┘
```

**Deployment Options:**
1. **Self-hosted:** Run Layer 1 yourself (no Semahub needed) — fully available today.
2. **Semahub managed:** Use Layer 2 (includes Layer 1, adds auth/billing/storage) — not built.

### What gitsema Already Provides (Layer 1, Phases 100–117)

- ✓ HTTP API multi-tenancy support (`gitsema tools serve`)
- ✓ Multi-machine indexing (`gitsema tools serve --port 4242`)
- ✓ Bearer token authentication infrastructure, hashed repo tokens
- ✓ Remote client support (`remoteClient.ts` for proxying)
- ✓ Persistent, registry-backed server-side repo storage (Phase 100)
- ✓ Pluggable storage backends — sqlite / postgres+pgvector / qdrant (Phases 101–103)
- ✓ LSP/MCP `--remote` delegation via `src/core/remote/protocolClient.ts` (Phase 113)
- ✓ LSP structural navigation (call hierarchy, exact definition/references) (Phase 114)
- ✓ LSP diagnostics, code lens, rich hover (Phase 115)
- ✓ WebSocket transport for MCP/LSP (Phase 116)
- ✓ MCP Streamable HTTP transport (Phase 117)

**Conclusion:** Layer 1 is done. There is no remaining gitsema-side work blocking Semahub — what's missing is entirely Layer 2 (a separate project).

### What Semahub (Separate Project) Needs

**Key insight:** Semahub doesn't need to reimplement gitsema infrastructure. It adds a thin layer on top of gitsema's existing remote MCP capabilities.

**1. User Management** (Semahub-specific)
- Signup, login, password reset, email verification
- OAuth2 (GitHub, Google, etc.)
- Database: PostgreSQL `users`, `organizations` tables
- Integrates with gitsema auth: generates Bearer tokens

**2. Repository Registry** (Semahub-specific)
- User registers git repos (HTTP POST to Semahub API)
- Metadata: repo URL, description, owner, last indexed
- Database: `repos`, `user_repos`, `permissions` tables
- Access control: private/public, team sharing, RBAC

**3. Indexing Job Queue** (Semahub-specific)
- Queue system (Redis/RabbitMQ) for async indexing jobs
- Enqueue `gitsema index start` calls to load-balanced servers
- Track job status (pending/running/done/failed)
- Store logs and metrics
- Notify user on completion/failure

**4. Index Storage Backend** (Semahub-specific)
- S3/MinIO to store index data per user/repo (or point at the existing
  postgres/qdrant backends in managed mode)
- Metadata: index size, timestamp, model version
- Lifecycle management (cleanup old indexes, archival)
- Streaming index download to users

**5. API Gateway + Load Balancing** (Semahub-specific, routes to Layer 1)
- Authenticate requests (issue Bearer token for MCP/LSP `--remote`)
- Route to available gitsema server instance
- Rate limiting per user tier
- Quota enforcement (storage, concurrent jobs)

**6. Billing & Subscriptions** (Semahub-specific)
- Subscription tiers (free: 100MB, pro: 10GB, enterprise: unlimited)
- Usage tracking: storage, indexing compute hours, query count
- Stripe integration for payments
- Cost model: $/GB stored + $/indexing compute hour

**7. Web Dashboard** (Semahub-specific)
- Repo management (register, remove, settings)
- Indexing status and history
- Billing and usage metrics
- Account settings, API keys
- Team management (for paid plans)

**8. CLI Integration** (Semahub uses existing gitsema commands)
- `gitsema auth login https://semahub.com` (device flow or browser) — not yet implemented in gitsema
- `gitsema config set service.url https://semahub.com`
- `gitsema tools lsp --remote api.semahub.com` (uses Semahub token) — `--remote` exists; token-issuance flow is Semahub's job
- `gitsema tools mcp --remote api.semahub.com` (uses Semahub token) — same

### Design Gaps

> **Refined into:** the gitsema-side identity/auth/access-control work
> (user accounts, `gitsema auth login/logout/token`, per-user per-repo
> per-branch grants, org-scoped self-service, SSO linking) has been promoted
> to its own design document: **[`docs/multi-tenant-auth-plan.md`](multi-tenant-auth-plan.md)**.
> The gaps below are kept for history; see that doc for resolved answers and
> the remaining genuinely-open questions.

- [x] `gitsema auth login`/`logout`/`token` commands — see `multi-tenant-auth-plan.md` §4.3, §5 Phase A.
- [x] How are user credentials stored locally? — see `multi-tenant-auth-plan.md` §4.1 (follows the existing `config.json` plaintext-secret precedent, `~/.config/gitsema/credentials.json`, 0o600).
- [x] Token expiration & refresh flow? — see `multi-tenant-auth-plan.md` §4.1 (sessions expire, API keys don't by default, `--expires` opt-in).
- [x] Team sharing (shared indexes, collaborative access)? — see `multi-tenant-auth-plan.md` §4.2 (orgs, per-repo/per-branch `repo_grants`, org-scoped self-service).
- [ ] What's the max index size per user tier? — still open; Semahub Layer-2 (billing/quota) territory, not gitsema-side.
- [ ] Rate limits (queries/sec, indexing jobs/month)? — still open; per-user/org quotas explicitly out of scope for `multi-tenant-auth-plan.md` Phases A–D (see its §6), deferred to Semahub Layer 2.
- [ ] Audit logging (who indexed what, when)? — partially addressed: `multi-tenant-auth-plan.md` §5 Phase D scopes a gitsema-side `audit_log` table, but it's the lowest-priority phase and may slip.
- [ ] SLA and uptime guarantees? — still open; Semahub Layer-2.
- [ ] Data residency (GDPR compliance)? — still open; Semahub Layer-2.

### MVP Scope

Start small:
1. **Phase A (Semahub):** User signup, index storage, job queue
2. **Phase B (gitsema):** see `docs/multi-tenant-auth-plan.md` for the now-fully-designed phased plan (Phases A–D there, ~1850–2550 LOC total) — supersedes the placeholder estimate that used to be here.
3. **Phase C (Semahub):** Web dashboard, billing

### Competitive Advantages

- **Integrated IDE experience:** CLI, LSP, MCP all work seamlessly
- **Structural analysis:** Not just search—call graphs, hotspots, ownership
- **Low-latency:** Semantic analysis in milliseconds
- **Flexible:** Self-hosted or SaaS, offline or online
- **Open-source core:** gitsema is open, builds trust

### Related Marketing Angle

- "Ship faster. Understand your codebase like never before."
- Target: Teams >3 devs (easier to sell SaaS), DevTools teams
- Compare favorably to: GitHub Copilot (search-only), Codebase AI (no structural analysis)

### Product Strategy: Two Tiers

**Tier 1: Self-Hosted Remote MCP — ✅ available today**
- Self-hosted developers deploy `gitsema tools mcp --http`/`--websocket` and `gitsema tools serve`
- Use gitsema natively for IDE integration (LSP/MCP) with a remote index
- No user management, no billing needed
- Core competency: semantic indexing engine + remote protocols

**Tier 2: Semahub SaaS — not started**
- Managed Semahub handles: auth, billing, storage, job queue
- Users login to Semahub, register repos, get index access
- Transparent to developers: same `gitsema auth`, `gitsema tools lsp --remote`
- Revenue: subscription fees for managed hosting + compute

### Prerequisites
- None — Layer 1 is complete (Phases 100–117); Semahub can start independently as a separate project.

---

## Plugin API for Custom Analysers

### Problem
- All search/analysis commands are built into gitsema's core; third parties
  can't add their own without forking
- Listed in `docs/PLAN.md`'s "Long-Term Investments" table (High complexity),
  not yet designed

### Intended Behavior
Allow a third-party module to register a new CLI subcommand / MCP tool /
analysis pass without modifying gitsema core — e.g. a custom debt heuristic,
a language-specific structural extractor, or an org-specific compliance scan.

### Design Gaps
- [ ] Plugin discovery mechanism (npm package convention? config-declared paths?)
- [ ] What surface does a plugin get: read-only `MetadataStore`/`VectorStore`
      access? Raw DB handle? Only the public `search`/`graph` APIs?
- [ ] How does a plugin register a new CLI command / MCP tool / HTTP route
      without each interface needing bespoke wiring?
- [ ] Versioning/compatibility contract between plugin API and gitsema's
      internal schema (since the schema is still evolving, v26 as of now)
- [ ] Security: plugins run with full Node.js privileges in-process — is a
      sandboxed/IPC model worth the complexity, or is "trust the plugin
      author" acceptable for a dev tool?

### Effort Estimate
- Design alone is nontrivial (the security/sandboxing question needs an
  answer before implementation starts); implementation likely 1000+ LOC for
  a usable v1 (registration, one new interface's wiring, docs).

### Prerequisites
- None blocking; lowest priority of the open ideas since no specific plugin
  use case has been requested yet.

---

## Shared/Deduplicated Indexing for Public Repos

> **Refined into:** the access-control half of this idea (a `visibility`
> flag, auto-granted read access when a user attaches to an existing public
> repo, and abuse-resistant gating of first-index vs. refresh) has been
> promoted to its own design document:
> **[`docs/public-repo-sharing-plan.md`](public-repo-sharing-plan.md)**.
> That doc's research also found that the storage/clone-duplication concern
> this idea originally worried about is **already solved** today —
> `src/core/indexing/repoRegistry.ts` already dedupes registrations by
> normalized URL onto one clone/index DB, and re-indexing an unchanged repo
> is already cheap (incremental + blob-hash dedup). See that doc's §2 for
> the full citations.

The second, looser shape below — cross-repo blob-level dedup for forks with
*different* URLs — was explicitly kept **out of scope** for that design (it's
architecturally a much bigger lift) and remains here as a genuinely
undesigned idea:

### Remaining open idea: partial index reuse / blob-level sharing across forks
Even for different URLs (e.g. a fork), recognize when blobs are
byte-identical (same blob hash — already how gitsema dedupes *within* one
repo) and skip re-embedding those blobs server-wide, only embedding the
genuinely new/changed blobs introduced by the fork.

- [ ] Requires re-scoping `blobs`/`embeddings` storage to be content-
      addressed *globally* rather than per-repo-DB file, cutting across the
      storage-backend abstraction (`src/core/storage/types.ts`) and every
      backend (sqlite/postgres/qdrant).
- [ ] Needs a cross-repo identity for a blob beyond what one index DB knows
      — either a shared blob registry + per-repo lookup tables, or a
      sync/copy mechanism between DBs.
- [ ] Interacts with whatever visibility/grant model
      `public-repo-sharing-plan.md` ships — sharing blobs across two
      *different* repos' indexes raises the same "who's allowed to read
      what" questions as that doc, just one level deeper (blob-level instead
      of repo-level).

### Effort Estimate
- Substantial — comparable in size to the storage-backends work itself
  (multi-phase). Not estimated further until shape-1's access-control layer
  (`public-repo-sharing-plan.md`) ships and proves out the simpler case.

### Prerequisites
- `docs/public-repo-sharing-plan.md` landing first (the visibility/grant
  model this would need to extend), and likely `multi-tenant-auth-plan.md`
  before that.

---

## Superadmin-Locked Model Set (Server-Side Model Allowlist)

> **Refined into:** **[`docs/locked-model-set-plan.md`](locked-model-set-plan.md)**.
> That doc's research found that the embedding half of this idea needed a
> genuinely new capability — a multi-tenant server has only ever had a
> single, process-wide embedding model with no per-request override, so
> "locking" it was previously a no-op; the design adds multi-profile serving
> first, then admin/org-level enabled-set control on top. The narrator/guide
> half was already multi-model today and just needed admin-gating + a
> never-persisted BYOK path, both designed in that doc. The gaps below are
> kept for history; see that doc for resolved answers and remaining open
> questions.

### Problem
- On a shared/multi-tenant server (`gitsema tools serve`), nothing today
  stops a user from indexing or querying with whatever
  `GITSEMA_MODEL`/`GITSEMA_TEXT_MODEL`/`GITSEMA_CODE_MODEL` they pass —
  there's no concept of an operator-controlled allowed set.
- This matters most for **embedding models**: vectors from two different
  embedding models aren't comparable, so if a shared index's vectors mix
  models, search silently degrades or breaks. A server operator needs to be
  able to pin the server to one (or a small vetted few) embedding model(s)
  so every repo's index stays internally consistent.
- It also applies to narrator/guide chat models (used by `narrate`/`explain`/
  `guide`), though the motivation there is different (cost/quality/abuse
  control of LLM calls) rather than vector compatibility.
- There's currently no "superadmin" role concept at all in gitsema — today's
  server auth is a single global `GITSEMA_SERVE_KEY` plus per-repo
  `repo_tokens` (see `docs/multi-tenant-auth-plan.md` for the in-progress
  identity/role model this idea would need to sit on top of).

### Intended Behavior
A server superadmin configures an **allowed model set** — separately for
embedding models and for narrator/guide models — via a new admin CLI/API
(not just a config file edit, per the answered design question, since this
needs to be a controlled, auditable admin action once roles exist). Regular
users:
- When the allowed set has exactly one model, see it as a **pre-selected,
  disabled** choice (not an editable picker) wherever a model would
  otherwise be selectable (`index start --model`, `gitsema config set
  model`, etc.) — they always see *which* model is active, they just can't
  change it.
- When the allowed set has more than one model, get a real picker limited to
  that set.
- Can still **bring their own API key (BYOK)** to use a model of their own
  choosing for narrator/guide chat, even when the server's own default
  narrator/guide model is locked or disabled entirely ("lock to none" is an
  explicit valid server posture for chat — i.e. no server-provided chat
  model at all, BYOK-only). BYOK does not apply to embedding models, since
  BYOK embeddings would reintroduce the vector-incompatibility problem this
  idea exists to prevent.
- Per the answered design question, the allowed set is **global by default**
  (set by the superadmin for the whole server) but an **org_admin may
  further narrow** (never widen) the set for their own org — layering on top
  of `docs/multi-tenant-auth-plan.md`'s org/role model rather than
  introducing a second, separate permission system.

### Design Gaps
- [ ] The "superadmin" role doesn't exist yet — does it ride on top of
      `multi-tenant-auth-plan.md`'s eventual `org_admin`/user roles as a new
      server-wide role, or is it a separate concept (e.g. tied to whoever
      holds `GITSEMA_SERVE_KEY` today)? This idea is blocked on that role
      existing in some form.
- [ ] Exact shape of the new admin CLI/API: `gitsema admin models allow
      <model> [--kind embedding|narrator]` / `gitsema admin models deny
      <model>`? An HTTP route under `/api/v1/admin/...`? Both?
- [ ] What happens to a repo's *existing* index if the superadmin later
      removes its embedding model from the allowed set — does search just
      stop working for that repo (data still there, queries rejected), or
      does it force a re-index banner/block?
- [ ] How does org-level narrowing interact with personal groups
      (`multi-tenant-auth-plan.md` §4.2a) — does a personal group count as
      an "org" for this purpose, or do personal-group users always inherit
      the server-wide set unmodified?
- [ ] Where does the "pre-selected, disabled" single-model UX surface
      outside the CLI — does the (currently nonexistent) Semahub web
      dashboard need this too, or is this purely a CLI/HTTP-API-level
      concern for now?
- [ ] BYOK credential storage/handling for narrator/guide: does the user's
      own API key get stored server-side (raising the same plaintext-secret
      precedent question as `multi-tenant-auth-plan.md` §4.1), or is it
      supplied per-request only and never persisted?

### Effort Estimate
- Depends heavily on the role-model prerequisite landing first. Once a
  role/permission system exists (per `multi-tenant-auth-plan.md`), this is a
  moderate addition: a new allowlist concept (global + org-level override),
  admin CLI/routes to manage it, and enforcement points at every model-
  selection site (`index start`, `config set model/textModel/codeModel`,
  narrator/guide model activation). Rough order: 500-800 LOC, mostly
  enforcement-point plumbing rather than novel architecture.

### Prerequisites
- Needs a superadmin/role concept to exist — directly depends on
  `docs/multi-tenant-auth-plan.md` landing (at least Phase A's user/session
  model, likely Phase B's org/role model for the org-level narrowing
  behavior). Not actionable before that.

---

## Public Repo Sharing: Throttle/Rate-Limit Unification & Policy Extraction

### Problem
- Found during the `/simplify` review of Phase 126/127 (public-repo-sharing).
  `checkAndRecordReindexThrottle()` (`src/server/routes/remote.ts`) is a
  bespoke per-`(repoId, userId)` cooldown map, separate from the generic
  abuse-prevention rate limiter in `src/server/middleware/rateLimiter.ts`
  (`express-rate-limit`, keyed by Bearer token/IP, fixed window). They serve
  different concerns today — one is a global RPM cap, the other a
  business-rule re-index cooldown — but having two independent
  rate-limiting mechanisms in the same route module is worth revisiting if
  a third throttle-shaped requirement shows up.
- The same review flagged that the 2c/2d/2e public-repo gate/throttle/grant
  logic in the `POST /api/v1/remote/index` handler (first-index gate,
  refresh throttle, attach-as-reader auto-grant) could be extracted into a
  single `applyPublicRepoPolicy()` function for readability, but that was
  judged too large a restructuring for a cleanup pass on already-shipped
  code.

### Intended Behavior
No design committed yet. Two independent, optional follow-ups:
- If a third per-key throttle need appears, consider whether a shared
  generic "keyed cooldown" utility (used by both `rateLimiter.ts` and
  `checkAndRecordReindexThrottle`) is worth building, vs. keeping them
  separate as distinct concerns.
- Extract the public-repo gate/throttle/grant sequence in
  `src/server/routes/remote.ts` into a named `applyPublicRepoPolicy()` (or
  similar) function once it grows another condition or gets touched again,
  rather than as a standalone refactor now.

### Design Gaps
- [ ] Whether a generic keyed-cooldown abstraction is worth the indirection
      given only one current caller (`checkAndRecordReindexThrottle`).
- [ ] Where the line is for "policy extraction" — at what point does the
      2c/2d/2e sequence justify its own function vs. staying inline.

### Effort Estimate
- Small either way — both are isolated, mechanical refactors with existing
  test coverage to verify against.

### Prerequisites
- None — both are optional cleanups on already-shipped Phase 126/127 code.

---

## `index doctor --fix` Generalization & Multi-Profile Ephemeral-Job Parity

### Problem
- Found during the `/simplify` review of Phase 131 (`index doctor --fix`) and
  the multi-profile embedding-serving feature (Phase 128).
- `doctorCommand`'s `--fix` block (`src/cli/commands/doctor.ts`) hardcodes one
  `if` branch per fixable `DoctorReport` finding (`ftsMissingCount`,
  `orphanEmbeddings`), each with its own bespoke repair call and print
  statement. It works for two findings but doesn't generalize — a third
  repairable finding (e.g. a future schema/provenance issue) means another
  copy-pasted `if` block rather than slotting into a shared structure.
- Separately, `src/server/routes/remote.ts`'s multi-profile resolution
  (Phase 128) only routes *persisted* indexing jobs through the
  `profiles` map; ephemeral (non-persisted) jobs always use the bare
  module-level `textProvider`/`codeProvider` pair, bypassing profile
  resolution entirely even on a server configured with multiple profiles.
  This is a documented Phase 1 scope cut (see `docs/PLAN.md`'s Phase 128
  deviations), not a regression, but it's a second code path that could
  silently diverge from the persisted path's profile semantics later.
- Both were judged too large a restructuring for a cleanup pass on
  already-shipped/just-shipped code.

### Intended Behavior
No design committed yet. Two independent, optional follow-ups:
- Model each `DoctorReport` finding as `{ check, count, fix?: () => Promise<FixResult> }`
  so `--fix` becomes "for each finding with a fix, run it," and the
  post-fix report is generated generically from a second `runDoctor()` diff
  rather than maintaining parallel `console.log` lines per finding.
- Route ephemeral (non-persisted) `remote-index` jobs through
  `profiles.get('default')` too, so there's exactly one source of truth for
  "which provider pair runs this job" — persistence would only affect
  profile *pinning*, not provider *selection*.

### Design Gaps
- [ ] Whether a generic fix-registry is worth the indirection for only two
      current fixable findings, or whether to wait for a third before
      generalizing.
- [ ] Whether unifying the ephemeral/persisted provider-selection path
      changes observable behavior for any existing `--remote` callers that
      rely on the bare-pair fallback today.

### Effort Estimate
- `doctor --fix` generalization: small, isolated refactor with existing test
  coverage (`tests/integration/doctorFix.integration.test.ts`) to verify
  against.
- Ephemeral-job profile routing: medium — touches the hot indexing-request
  path in `remote.ts` and needs its own test coverage for the ephemeral case.

### Prerequisites
- None for the `doctor --fix` refactor.
- None beyond Phase 128 (already shipped) for the ephemeral-job routing fix.

---

## Pinned-Profile Exemption Generalization & Guide HTTP BYOK Mapping Cleanup

### Problem
- Found during the `/simplify` review of Phases 129–130 (admin-gated model
  allow-lists, BYOK for narrator/guide).
- `src/server/routes/remote.ts`'s "a pinned profile that was later disabled
  keeps working for its own repo" exemption (PLAN.md Phase 128 deviation) is
  a flat `if (resolvedProfileName && !pinnedProfileName && ...)` condition
  bolted directly onto this one route handler, rather than being a parameter
  on `modelPolicy.ts`'s allow-list resolution itself (e.g. an
  `isAllowed(..., { pinnedIdentifier })` shape). It works correctly today
  but could silently drift out of sync if a second enforcement point for
  this exemption is ever added elsewhere.
- `src/server/routes/guide.ts`'s HTTP route does an inline snake_case→camelCase
  mapping of the request body's `byok` fields (`byok_http_url` →
  `httpUrl`, etc.) rather than sharing a helper with the CLI's
  `parseByokCliOpts` (`src/cli/lib/byok.ts`) or the MCP tool's equivalent
  mapping in `src/mcp/tools/narrator.ts`. All three shapes differ slightly
  (string-typed CLI opts vs. typed-number HTTP body vs. flat snake_case MCP
  fields), so unifying them isn't a drop-in win.
- Both were judged single-occurrence, low-duplication-cost issues — not
  worth restructuring on a cleanup pass over code that just shipped.

### Intended Behavior
No design committed yet. Two independent, optional follow-ups:
- Move the pinned-profile exemption into `modelPolicy.ts`'s effective-set
  resolution (or a new `isAllowed()` helper) so any future second
  enforcement point inherits the same exemption automatically instead of
  re-implementing the `if` check.
- Decide whether a shared `byok` body-shape normalizer (CLI/HTTP/MCP) is
  worth introducing, or whether the three call sites should stay
  independently shaped since they're parsing genuinely different wire
  formats (CLI strings, JSON body, MCP flat fields).

### Design Gaps
- [ ] Whether a second enforcement point for the pinned-profile exemption is
      ever likely enough to justify generalizing now vs. waiting until one
      actually appears.
- [ ] Whether a shared BYOK body-shape normalizer would reduce real
      duplication or just add an abstraction layer over three already-small,
      already-distinct mapping functions.

### Effort Estimate
- Pinned-profile exemption push-down: small — one new optional parameter on
  an existing `modelPolicy.ts` function, plus updating the single call site
  in `remote.ts`.
- BYOK body-shape normalizer: small, but low value given only three
  call sites with differing shapes.

### Prerequisites
- None — both are isolated, optional refactors of already-shipped code.

---


## Related Issues & Documents

- **Parity tracking:** See `docs/parity.md` for tool availability across interfaces
- **Active roadmap:** See `docs/PLAN.md` for phases 111+ in development
- **Latest review:** See `docs/review10.md` for the most recent strategic review (note: all 8 of its concrete improvement points have since been addressed — check current source before assuming a finding is still live)

---

## How to Use This Document

1. **Planning next phase?** Check here for undesigned ideas
2. **User asks "can we do X"?** Check here for intended but unimplemented features
3. **Before designing a feature:** Verify it's not already captured here (to avoid duplicate work)
4. **After designing:** Move to a dedicated design file (e.g., `docs/design/lsp-remote.md`) and update `PLAN.md`

---

**Document Status:** ✓ Current (2026-06-22)
**Next Review:** When Semahub or the plugin API work begins
**Maintainer:** jsilvanus@gmail.com
