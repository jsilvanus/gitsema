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

## MCP Remote Delegation

### Problem
- MCP server (`gitsema tools mcp`) only works with local `.gitsema/index.db`
- Multi-machine setups have same issue as LSP
- No standard way to run MCP client on A, index on B

### Intended Behavior

**Three deployment modes:**
1. **Local MCP (current):** MCP stdio on local machine, index is local
   ```bash
   gitsema tools mcp  # Reads .gitsema/index.db locally
   ```

2. **Remote MCP (intended):** MCP stdio on local machine, index is remote HTTP
   ```bash
   gitsema tools mcp --remote localhost:4242
   # Proxies all MCP tool calls to remote HTTP API
   ```

3. **MCP over HTTP (future):** HTTP-based MCP protocol
   ```bash
   gitsema tools mcp --http 0.0.0.0:5000
   # External clients connect via JSON-RPC over HTTP/WebSocket
   ```

### Design Gaps
- [ ] Define `--remote <url>` flag for MCP (same as LSP)
- [ ] Specify MCP tools that require remote delegation (all of them?)
- [ ] Define authentication model (same Bearer token as HTTP server?)
- [ ] Define MCP HTTP transport (JSON-RPC over HTTP/WebSocket, per LSP spec)
- [ ] Specify error handling for network failures (how MCP reports errors)

### Effort Estimate
- MCP `--remote`: ~200-300 LOC (similar to LSP remote)
- MCP HTTP: ~300-400 LOC (extend HTTP server with MCP protocol handler)

### Prerequisites
- LSP `--remote` design should inform MCP `--remote` design (consistency)

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

## Summary: Deployment Modes & Phases

| Capability | Phase | Local Index | Remote Index (HTTP) | Remote MCP (HTTP) |
|---|---|:---:|:---:|:---:|
| **Search CLI** | Current | ✓ | ✓ (`--remote`) | — |
| **LSP stdio** | Current | ✓ | ✗ (gap) | — |
| **LSP TCP** | Current | ✓ | Workaround (SSH) | — |
| **LSP `--remote`** | 112 | ✓ | ✓ (intended) | — |
| **LSP WebSocket** | 113 | ✓ | ✓ (intended) | — |
| **LSP structural nav** | 113+ | ✓ | ✓ (w/ `--remote`) | — |
| **MCP stdio** | Current | ✓ | ✗ (gap) | — |
| **MCP `--remote`** | 112 | ✓ | ✓ (intended) | — |
| **MCP HTTP** | 113+ | — | — | ✓ (intended) |

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
