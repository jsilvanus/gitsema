# Feature Ideas & Design Gaps

This document tracks upcoming feature ideas that are **not yet in active development** (not in `PLAN.md`) and haven't been **fully designed** (no design file). It's a staging area for "what now?" questions and medium-term product direction.

**Last updated:** 2026-06-22 (added shared/deduplicated public-repo indexing idea)
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

### Problem
- The Semahub vision (and the multi-tenant auth work in
  `docs/multi-tenant-auth-plan.md`) assumes a remote server can index repos on
  behalf of many users, but says nothing about **public** repos specifically.
- Today, `gitsema tools serve`'s `GITSEMA_DATA_DIR` persistent-repo model
  (Phase 100) and the planned `repo_grants` access model both key storage by
  `repoId` with no concept of "this repo's content is identical to one
  another user already indexed." If ten users each register
  `github.com/torvalds/linux` against the same server, today's model clones
  and embeds it ten separate times — ten full histories, ten sets of
  embeddings, ten times the storage and compute, for content that is
  byte-for-byte identical at the blob level.
- This is exactly the kind of abuse/cost vector that matters once a server is
  open to multiple tenants (per the auth design currently being added): one
  user "forking" a popular public repo and re-triggering a full index is pure
  waste — gitsema's own content-addressed dedup (the blob-hash identity
  design constraint) already solves this *within* one repo's history, but
  there's nothing today that recognizes "this whole repo, or significant
  parts of it, has already been indexed by someone else."

### Intended Behavior
For a repo whose remote URL is recognized as **public** (or explicitly
marked shared), the server should index it **once** and let every user who
registers that same URL search against the existing index, rather than
re-cloning and re-embedding from scratch. Two shapes this could take:

1. **One canonical index per public repo URL.** The server normalizes the
   remote URL (already has `normalized_url` on `repos` per the Phase 100
   schema) and, on a second registration of the same URL, attaches the
   requesting user/org as a *reader* of the existing index instead of
   creating a new one. Per-user value-add (e.g. a private branch, as raised
   in the personal-grants discussion in `multi-tenant-auth-plan.md` §3 Axis
   C) layers on top as an incremental partial index against the same base,
   not a full reindex.
2. **Partial index reuse / blob-level sharing across repos.** Looser than
   (1): even for *different* URLs (e.g. a fork), recognize when blobs are
   byte-identical (same blob hash — which is already how gitsema dedupes
   *within* a repo) and skip re-embedding those blobs server-wide, only
   embedding the genuinely new/changed blobs introduced by the fork. This is
   a bigger lift since today's schema scopes `blobs`/`embeddings` per index
   DB (or per storage-backend scope), not globally across repos.

Either shape needs a definition of "public" — likely: the server checks the
origin host's API (GitHub/GitLab/etc. "is this repo public") at registration
time, or an operator-set allowlist/heuristic, or simply "any URL, dedup by
exact blob hash, regardless of visibility" (shape 2 doesn't actually require
knowing visibility at all — it's blob-hash equality, which is content, not a
policy fact).

### Design Gaps
- [ ] Shape (1) vs (2) vs both — (1) is far simpler (de-dupe at the
      whole-repo level) but provides zero benefit for forks/mirrors with
      partially overlapping history; (2) handles forks but requires
      cross-repo blob/embedding storage scoping that doesn't exist today.
- [ ] How is "public" determined? Provider API call (GitHub/GitLab "is
      public" check, needs network access + provider-specific clients),
      operator allowlist, or sidestepped entirely by going straight to
      blob-hash dedup regardless of visibility?
- [ ] If multiple users share one canonical index, how does access control
      interact with `multi-tenant-auth-plan.md`'s `repo_grants` model — is
      "read access to a public repo's shared index" implicit for any
      authenticated user, or still a grant row (just auto-issued)?
- [ ] Re-indexing/refresh ownership: if repo X is shared across N users, who
      can trigger `index start --since all`, and how do per-user overrides
      (e.g. someone indexing with `--graph` when the canonical index doesn't
      have graph data) get reconciled without forking the canonical index?
- [ ] Storage/billing implications for Semahub Layer 2: a shared public index
      breaks the naive "bill per indexed repo per user" model — needs a
      "first indexer pays, others read free (or at reduced cost)" policy,
      which is product/billing territory, not gitsema-side, but the
      *mechanism* gitsema exposes (shared index, attach-as-reader) has to
      exist for Semahub to build that policy on top of it.
- [ ] Quota/abuse angle that motivated this idea: should the server simply
      *rate-limit or reject* re-indexing a URL that's already indexed and
      unchanged (cheap, no new mechanism) as a stopgap, independent of
      whether full shared-index support ever ships? That's a much smaller,
      separate hardening change worth calling out if this idea stalls.

### Effort Estimate
- Shape (1) alone: moderate — mostly registration-time URL-lookup logic plus
  a new "attach existing repo as reader" path in the `GITSEMA_DATA_DIR`
  repo-registry code (Phase 100) and an auto-grant interaction with
  `repo_grants`. Rough order: 400-700 LOC.
- Shape (2): substantial — requires re-scoping `blobs`/`embeddings` storage
  to be content-addressed *globally* rather than per-repo-DB, which cuts
  across the storage-backend abstraction (`src/core/storage/types.ts`) and
  every existing backend (sqlite/postgres/qdrant). Likely a multi-phase
  effort comparable in size to the storage-backends work itself.

### Prerequisites
- Logically follows the multi-tenant auth/access-control work
  (`docs/multi-tenant-auth-plan.md`) — sharing an index across users only
  matters once a server actually has multiple distinct user identities to
  share it *between*. Should be scoped as a Semahub-adjacent Layer 1 idea
  once that auth work lands, not before.

---

## Related Issues & Documents

- **Parity tracking:** See `docs/parity.md` for tool availability across interfaces
- **Active roadmap:** See `docs/PLAN.md` for phases 111+ in development
- **Latest review:** See `docs/review9.md` for the most recent strategic review (note: most of its open findings have since been resolved — check current source before assuming a finding is still live)

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
