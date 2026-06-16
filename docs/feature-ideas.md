# Feature Ideas & Design Gaps

This document tracks upcoming feature ideas that are **not yet in active development** (not in `PLAN.md`) and haven't been **fully designed** (no design file). It's a staging area for "what now?" questions and medium-term product direction.

**Last updated:** 2026-06-16  
**Audience:** Developers considering next phases; product planning

---

## LSP Remote Delegation & Transport

### Problem
- LSP server (`gitsema tools lsp`) only works with local `.gitsema/index.db`
- Multi-machine setups (IDE on A, index on B) have no clean solution
- Current workarounds: SSH tunnel to B's LSP (bottleneck), SSHFS mount (SQLite latency), or stale local copy

### Intended Behavior
**Local LSP server querying remote HTTP-based index:**
```bash
# Computer B (server)
gitsema tools serve --port 4242

# Computer A (client)
gitsema tools lsp --remote localhost:4242  # or server.company.com:4242
# Or with SSH tunnel: ssh -L 4242:localhost:4242 user@B then lsp --remote localhost:4242
```

### Design Gaps
- [ ] Define `--remote <url>` flag for `gitsema tools lsp`
- [ ] Specify which LSP queries require remote delegation (all vectorSearch, symbol lookups, etc.)
- [ ] Define error handling for remote timeouts / network failures
- [ ] Specify authentication model (Bearer token? Inherit from HTTP server?)
- [ ] Performance budgets: acceptable latency for hover, definition, references

### Related Workaround
**SSH tunnel to LSP on B (current, not recommended for scale):**
```bash
# Computer B: gitsema tools lsp --tcp 2087
# Computer A: ssh -L 2087:localhost:2087 user@B
# IDE connects to localhost:2087
```
This works but makes B's LSP a bottleneck for multiple developers. Only suitable for 1-2 developers per server.

### Effort Estimate
- Implementation: ~400-500 LOC
- Create "remote session" wrapper around LSP handlers
- Extend HTTP server routes for LSP-specific queries
- Testing: multi-machine integration tests

---

## LSP WebSocket Transport

### Problem
- LSP supports stdio and TCP, but TCP requires port exposure or SSH tunneling
- WebSocket is HTTP-compatible (works through firewalls/proxies, no special firewall rules)
- Standard for remote LSP in modern IDEs (VS Code, Vim, Neovim plugins)

### Intended Behavior
```bash
# Computer B (server behind corporate firewall)
gitsema tools lsp --websocket 0.0.0.0:443  # TLS if terminated by nginx/Caddy

# Computer A (any IDE with WebSocket support)
Connect to: wss://gitsema.company.com/lsp
```

### Design Gaps
- [ ] Define `--websocket <bind-address>` flag for `gitsema tools lsp`
- [ ] Specify TLS handling (gitsema terminates? or expect nginx proxy?)
- [ ] Define URI path routing (`/lsp`? root? configurable?)
- [ ] Specify authentication (optional Bearer token, OAuth2?)
- [ ] Performance: acceptable latency over WebSocket vs. TCP (should be similar, ~10-20ms)

### Use Cases
1. **Distributed team:** One gitsema server, many IDEs across locations
2. **Browser-based IDE:** Upstream support for Theia, VS Code Web, etc.
3. **Corporate network:** Works through HTTP proxy / firewall-friendly

### Effort Estimate
- Implementation: ~200-300 LOC
- Add WebSocket library (or use Node.js native `WebSocketServer` if available)
- Extend message parsing/serialization to handle WebSocket frames
- Testing: cross-IDE compatibility (VS Code, Vim, Neovim)

### Prerequisites
- LSP `--remote` support should land first (Phase 112)
- WebSocket can be Phase 113

---

## LSP Structural Navigation

### Problem
- Current LSP uses semantic search (fuzzy) for definition/references
- Doesn't leverage structural graph (`graph_nodes`, `edges` from Phase 107)
- Missing call hierarchy, precise import/implementation resolution

### Intended Behavior
```
IDE hover over function foo():
  [Current]  Semantic matches: bar.ts, baz.ts (fuzzy)
  [Intended] Call info: 42 callers, 3 callees (precise)
  
IDE "Go to Definition" for import:
  [Current]  Symbol name match + semantic fallback
  [Intended] Exact import resolution from structural graph
  
IDE "Find References" for function:
  [Current]  Symbol name + FTS text mentions
  [Intended] Exact call graph: all 42 callers listed
```

### Design Gaps
- [ ] Map LSP `callHierarchy/incomingCalls` to `edges` table (call graph)
- [ ] Map LSP `callHierarchy/outgoingCalls` to `edges` table
- [ ] Define precedence: structural (precise) vs. semantic (fallback)
- [ ] Specify behavior when structural graph not available (graceful degradation)
- [ ] Performance: acceptable latency for large call graphs (1000+ callers?)

### Data Dependencies
- Requires `index --graph` to populate `structural_refs` (Phase 106)
- Requires `gitsema graph build` to populate `graph_nodes` and `edges` (Phase 107)
- Currently: only TS/TSX/JS/Python supported for structural extraction

### Effort Estimate
- Implementation: ~300-400 LOC
- Enhance LSP handlers to query `edges` table in addition to symbols
- Add LSP `callHierarchy` provider methods
- Testing: language-specific call graphs

### Prerequisites
- Phase 107+ must be complete and graph built
- LSP `--remote` support (above) should exist for consistency

---

## LSP Diagnostics & Code Lens

### Problem
- LSP currently shows information on hover/definition only
- No real-time warnings about code quality, risk, debt
- No inline metrics visible without hovering

### Intended Behavior

**Diagnostics (warnings in IDE):**
```typescript
function processPayment(amount) {  // ← WARNING: High hotspot risk
  // Touches 5 modules | Called 200x/month | Debt: 0.8
}
```

**Code Lens (inline metrics):**
```typescript
function sendEmail(to, subject) {  // ← "Called 42 times | Last: 2h ago"
  return email.send(...)
}
```

### Design Gaps
- [ ] Define diagnostic severity levels (error vs. warning vs. info)
- [ ] Specify which analyses trigger diagnostics (hotspots, debt, churn, security)
- [ ] Define thresholds (e.g., hotspot if risk > 0.7)
- [ ] Specify code lens refresh frequency (on file save? every N seconds?)
- [ ] Define which metrics show in lens (calls, ownership, churn, debt score?)

### Data Dependencies
- Hotspots: Requires Phase 110
- Debt scoring: Requires Phase 104+
- Churn metrics: Requires blob_commits analysis
- Ownership: Requires blob_commits join with authors

### Effort Estimate
- Implementation: ~200-300 LOC per diagnostic type
- Add LSP diagnostic publisher methods
- Compute and cache metrics on background timer
- Testing: false positive rates, performance under load

### Prerequisites
- LSP `--remote` support (above)
- Underlying analyses (hotspots, debt, churn) must be complete

---

## MCP Remote Delegation & HTTP Transport (Foundation for Semahub)

### Problem
- MCP server (`gitsema tools mcp`) only works with local `.gitsema/index.db`
- Multi-machine setups have same issue as LSP
- No standard way to run MCP on client machine while index lives on server
- **Foundation blocker:** Self-hosted teams can't easily delegate indexing to server

### Intended Behavior

**Three deployment modes (layered):**

1. **Local MCP (current):** MCP stdio on local machine, index is local
   ```bash
   gitsema tools mcp  # Reads .gitsema/index.db locally
   ```

2. **Remote MCP (Phase 112):** MCP stdio on local machine, index is remote HTTP
   ```bash
   gitsema tools mcp --remote localhost:4242
   # Proxies all MCP tool calls to remote HTTP API
   ```

3. **MCP over HTTP/WebSocket (Phase 113):** HTTP-based MCP transport
   ```bash
   # Server
   gitsema tools mcp --http 0.0.0.0:4242
   
   # Client (e.g., VS Code extension, web IDE)
   Connect to: ws://server:4242/mcp
   ```

### Strategic Context
This is the **foundation for Semahub.** Self-hosted remote MCP enables:
- Distributed teams (developers on A, index on B)
- Centralized index server (multiple developers → one powerful index)
- Load balancing (multiple gitsema servers behind proxy)
- **Then:** Semahub wraps this with auth, billing, multi-tenancy

### Design Gaps

**For MCP `--remote` (Phase 112):**
- [ ] Define `--remote <url>` flag for MCP (same as LSP)
- [ ] Specify MCP tools that require remote delegation (all?)
- [ ] Error handling: how MCP reports network failures
- [ ] Performance: acceptable latency for tool calls (hover, search, etc.)

**For MCP HTTP/WebSocket (Phase 113):**
- [ ] Define WebSocket URI path routing (`/mcp`? configurable?)
- [ ] TLS handling (gitsema terminates? expect nginx proxy?)
- [ ] Authentication (Bearer token, OAuth2?)
- [ ] Streaming: how to handle large result sets over HTTP
- [ ] Backpressure: rate limiting on HTTP layer
- [ ] Reconnection strategy (heartbeat, exponential backoff)

### Effort Estimate
- MCP `--remote`: ~200-300 LOC (similar to LSP remote)
- MCP HTTP/WebSocket: ~400-500 LOC (new protocol handler, streaming support)

### Prerequisites
- LSP `--remote` design (Phase 112) should inform MCP `--remote`
- HTTP server already has multi-tenancy hooks from Phase 101+
- Can leverage same auth/routing/quota infrastructure

### Semahub Dependency
**Semahub builds on top of this:** Once self-hosted remote MCP is solid, Semahub adds:
- User management layer (on top of `--remote` auth)
- Multi-repo isolation (using existing multi-tenancy)
- Job queue (for async indexing)
- Managed storage (S3 backend instead of self-hosted filesystem)

---

## Improved LSP Hover with Temporal & Risk Data

### Problem
- Hover shows only semantic matches
- Missing valuable metadata: ownership, change frequency, debt, risk

### Intended Behavior
```markdown
Hovering over function foo():

**Semantic Matches:**
- bar.ts:234 — similarity: 0.92

**Temporal Info:**
- Last touched: 2 days ago by @alice
- Change frequency: 12x/month (high churn)

**Risk & Quality:**
- Debt score: 0.67 (moderate)
- Hotspot risk: HIGH (touches 5 modules)
- Security: 1 pattern match

**Structure (if graph available):**
- Callers: 42 places
- Callees: 3 functions
```

### Design Gaps
- [ ] Define hover content structure and prioritization
- [ ] Specify data sources (author from blob_commits, hotspots from Phase 110, etc.)
- [ ] Define which data sources are optional (graceful if some missing)
- [ ] Specify Markdown rendering for hover card

### Data Dependencies
- Authors: blob_commits + commits tables
- Churn: blob_commits frequency analysis
- Debt: requires Phase 104+ debt scoring
- Hotspots: requires Phase 110
- Structure: requires Phase 107+ graph

### Effort Estimate
- Implementation: ~150-200 LOC
- Extend hover handler to join multiple data sources
- Format Markdown hover response

### Prerequisites
- LSP `--remote` support (above)
- Some or all underlying analyses

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

**Layer 1: Self-Hosted Remote MCP (Phase 112-113)**
```
┌──────────────────────────────────┐
│     gitsema tools mcp --http     │ ← MCP over WebSocket
│     (load-balanced, multi-tenant) │
└──────────────┬───────────────────┘
               │
        ┌──────▼──────┐
        │ gitsema HTTP │ ← Multi-tenant HTTP API
        │   (Phase 101+)│   User isolation, auth, quotas
        └──────┬───────┘
               │
        ┌──────▼──────┐
        │ Local storage│ ← .gitsema/index.db on filesystem
        └─────────────┘
```

**Layer 2: Semahub (Built on Layer 1)**
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
1. **Self-hosted:** Run Layer 1 yourself (no Semahub needed)
2. **Semahub managed:** Use Layer 2 (includes Layer 1, adds auth/billing/storage)

### What gitsema Needs (Most is Phase 101+ Foundation)

**Already exists (Phase 101-103):**
- ✓ HTTP API multi-tenancy support (`gitsema tools serve`)
- ✓ Multi-machine indexing (`gitsema tools serve --port 4242`)
- ✓ Bearer token authentication infrastructure
- ✓ Remote client support (`remoteClient.ts` for proxying)

**New in Phase 112-113:**

**Phase 112: LSP/MCP `--remote` Delegation**
- [ ] `gitsema auth login` — authenticate with service, save token locally (~150-200 LOC)
- [ ] `gitsema auth logout`, `gitsema auth token` (~100 LOC)
- [ ] `gitsema config set service.url`, `service.token` (~100 LOC)
- [ ] LSP `--remote` flag (~400-500 LOC, reuse HTTP infrastructure)
- [ ] MCP `--remote` flag (~200-300 LOC, reuse HTTP infrastructure)

**Phase 113: WebSocket Transport**
- [ ] `gitsema tools lsp --websocket 0.0.0.0:4242` (~200-300 LOC)
- [ ] `gitsema tools mcp --http 0.0.0.0:4242` (MCP over WebSocket) (~400-500 LOC)
- [ ] Streaming support for large result sets (~100-200 LOC)

**For Semahub Integration (Semahub Project, not gitsema):**
- Optional: `gitsema index start --service semahub` (convenience wrapper, ~100 LOC)
- Optional: `gitsema index status <repo-id>` (status polling, ~100 LOC)

**Total gitsema NEW code:** ~1500-2000 LOC (Phases 112-113)  
*Note: Most infrastructure (HTTP, multi-tenancy, auth hooks) exists in Phase 101+*

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
- S3/MinIO to store `.gitsema/index.db` per user/repo
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
- `gitsema auth login https://semahub.com` (device flow or browser)
- `gitsema config set service.url https://semahub.com`
- `gitsema tools lsp --remote api.semahub.com` (uses Semahub token)
- `gitsema tools mcp --remote api.semahub.com` (uses Semahub token)

### Design Gaps

- [ ] How are user credentials stored locally? (keychain integration?)
- [ ] Token expiration & refresh flow?
- [ ] What's the max index size per user tier?
- [ ] Rate limits (queries/sec, indexing jobs/month)?
- [ ] Team sharing (shared indexes, collaborative access)?
- [ ] Audit logging (who indexed what, when)?
- [ ] SLA and uptime guarantees?
- [ ] Data residency (GDPR compliance)?

### MVP Scope

Start small:
1. **Phase A (gitsema):** Auth + service config (~200 LOC)
2. **Phase B (gitsema):** HTTP multi-tenancy (~400 LOC)
3. **Phase C (Semahub):** User signup, index storage, job queue
4. **Phase D (gitsema):** Remote indexing delegation
5. **Phase E (Semahub):** Web dashboard, billing

**Total effort:** 2-3 months for MVP (gitsema: 2-3 weeks, Semahub: 6-8 weeks)

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

**Tier 1: Self-Hosted Remote MCP (Phase 112-113)**
- Self-hosted developers deploy `gitsema tools mcp --http` and `gitsema tools serve`
- Use gitsema natively for IDE integration (LSP/MCP) with remote index
- No user management, no billing needed
- Core competency: semantic indexing engine + remote protocols

**Tier 2: Semahub SaaS (After Phase 113)**
- Managed Semahub handles: auth, billing, storage, job queue
- Users login to Semahub, register repos, get index access
- Transparent to developers: same `gitsema auth`, `gitsema tools lsp --remote`
- Revenue: subscription fees for managed hosting + compute

### Effort Estimate

**Phase 112-113: Self-Hosted Remote MCP**
- gitsema changes: ~1500-2000 LOC, 4-6 weeks
- Infrastructure: User provides (on-prem, AWS, GCP, etc.)

**Semahub SaaS (Post Phase 113)**
- Semahub project: ~5000-7000 LOC, 8-10 weeks
- Infrastructure: Managed by Semahub (~$500-2000/month at scale)

### Prerequisites
- None for Layer 1 (can start after Phase 111)
- Layer 2 depends on Layer 1 complete (Phase 113+)

---

## Summary: Architecture Layers & Deployment Modes

**Layer 1: Self-Hosted Remote MCP (Phase 112-113) — THE FOUNDATION**

| Capability | Self-Hosted Local | Self-Hosted Remote | Notes |
|---|:---:|:---:|---|
| **Search CLI** | ✓ | ✓ (`--remote`) | Works with `gitsema tools serve` |
| **LSP stdio** | ✓ | ✗ (gap → Phase 112) | Use SSH tunnel workaround |
| **LSP `--remote`** | ✓ | ✓ | Phase 112: new `--remote` flag |
| **LSP WebSocket** | ✓ | ✓ | Phase 113: `--websocket` flag |
| **MCP stdio** | ✓ | ✗ (gap → Phase 112) | Use SSH tunnel workaround |
| **MCP `--remote`** | ✓ | ✓ | Phase 112: new `--remote` flag |
| **MCP HTTP** | — | ✓ | Phase 113: `--http` flag (new) |
| **Indexing** | ✓ | ✓ | Use `gitsema tools serve` (existing) |

**Layer 2: Semahub SaaS (Built on Layer 1) — BUILT ON FOUNDATION**

| Capability | Available | Notes |
|---|:---:|---|
| **All Layer 1 features** | ✓ | Web UI + managed infrastructure |
| **User authentication** | ✓ | Signup, login, OAuth2 |
| **Multi-user isolation** | ✓ | Repo isolation, permissions |
| **Managed storage** | ✓ | S3 backend, auto-cleanup |
| **Billing/subscriptions** | ✓ | Stripe integration |
| **Web dashboard** | ✓ | Repo mgmt, usage metrics |
| **Job queue** | ✓ | Async indexing, notifications |

---

## Related Issues & Documents

- **Parity tracking:** See `docs/parity.md` for tool availability across interfaces
- **Deployment:** SSH workaround documented in deployment guidelines (see how-to for remote LSP access)
- **Active roadmap:** See `docs/PLAN.md` for phases 111+ in development
- **LSP assessment:** See `docs/parity.md` § "LSP Interface Details" for current capabilities

---

## How to Use This Document

1. **Planning next phase?** Check here for undesigned ideas
2. **User asks "can we do X"?** Check here for intended but unimplemented features
3. **Before designing a feature:** Verify it's not already captured here (to avoid duplicate work)
4. **After designing:** Move to a dedicated design file (e.g., `docs/design/lsp-remote.md`) and update `PLAN.md`

---

**Document Status:** ✓ Current (2026-06-16)  
**Next Review:** When Phase 112+ starts (to move designed ideas to PLAN.md)  
**Maintainer:** jsilvanus@gmail.com
