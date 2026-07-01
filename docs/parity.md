# Tool Parity & Flag Coherence

This document tracks the availability of gitsema tools and commands across all interfaces, and the implementation of common flags across the CLI. It serves as the single source of truth for interface parity and helps identify gaps, inconsistencies, and opportunities for unification.

**Last updated:** 2026-07-01 (the only date in this document — see §4 for why)  
**Maintainer note:** Any tool change, interface change, or flag addition must be reflected in the tables below and in the canonical sections of `CLAUDE.md` / `docs/features.md` / `README.md`.

---

## 0. Local vs. Remote/Server Interfaces

gitsema's actual logic — search, indexing, the structural graph, everything —
always runs against one local index (SQLite/Postgres/Qdrant). Every interface
below is either purely **local** (no network exposure) or a **server** mode
that opens a socket so another process/machine can reach that same local
logic. This section is about *how a client reaches gitsema*, not about which
tools are available — that's §1.

| Interface | Default mode | Network mode(s) | Auth | Resource bounds |
|---|---|---|---|---|
| CLI | Local (direct DB access in-process) | — | n/a | n/a |
| REPL | Local (direct DB access in-process) | — | n/a | n/a |
| Guide | Local (in-process agentic loop) | — | n/a | n/a |
| `tools mcp` | stdio (spawned as a local child process) | `--websocket <bind-address>` (non-standard MCP transport, kept for forward compatibility); `--http <bind-address>` (Streamable HTTP — MCP's actual standard network transport, Phase 117) | `--key`/`GITSEMA_WEBSOCKET_KEY` (websocket); `--key`/`GITSEMA_MCP_HTTP_KEY` (http) | `maxPayload` 10MB + max 100 connections/sessions on both network modes (review10 §3) |
| `tools lsp` | stdio (spawned as a local child process) | `--tcp <port>` (raw TCP, `Content-Length`-framed, **deprecated**, Phase 120); `--websocket <bind-address>` | **none** (`--tcp` — deprecated in favor of `--websocket` rather than fixed, review10 §3.5/Phase 120); `--key`/`GITSEMA_WEBSOCKET_KEY` (`--websocket`) | max 100 connections on both network modes; `maxPayload` 10MB on `--websocket` |
| `tools serve` | Always a server (no local-only mode) | HTTP (REST-ish routes) | `--key`/`GITSEMA_SERVE_KEY` | `express.json({ limit })` body-size cap |

All network modes that support a key (everything except `--tcp`) print a
startup warning if bound to a non-loopback address with no key configured.
`--tcp` has no key option at all (raw TCP has no header to carry a token in),
so it always warns — and prints a deprecation notice on every invocation
recommending `--websocket --key` instead.

**`--remote <url>` is a separate axis, not another network-exposure mode.**
It's how *this* gitsema process delegates outbound to a remote `tools serve`
instance (Phase 113) — it has nothing to do with how a client reaches *this*
process. A single `tools mcp` invocation could simultaneously be reached over
`--http` (inbound) while delegating its own data access via `--remote`
(outbound) to a different server.

---

## 1. Tool Parity Matrix

This table shows which tools/commands are available in which interface. A checkmark (✓) means the tool is fully available; a dash (—) means it's not available in that interface.

### Legend
- **CLI**: Command-line interface (86 commands)
- **REPL**: Lightweight interactive search REPL (search only)
- **LSP**: Language Server Protocol for IDE integration (9 protocol methods: hover, definition, references, document/workspace symbol, call hierarchy, code lens) — available over stdio, `--tcp` (deprecated, Phase 120), or `--websocket` (see §0); tool availability is identical across all three, since they're just transports onto the same dispatcher
- **Guide**: Agentic tool-calling loop in `gitsema guide` (49 tools, max 5 roundtrips)
- **MCP**: Model Context Protocol tools (38 tools for AI clients) — available over stdio, `--websocket`, or `--http` (see §0); tool availability is identical across all three, since they're just transports onto the same `McpServer`
- **HTTP**: REST API server via `gitsema tools serve` (~30 endpoints)
- **CLI Interactive** (planned): Full CLI in interactive mode
- **Web UI** (planned): Browser-based interface

### Tool Matrix

| Tool/Command | CLI | REPL | LSP | Guide | MCP | HTTP | Interactive | Web UI |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Search & Discovery** |
| `search` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `first-seen` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `code-search` | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| `dead-concepts` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Analysis & Trends** |
| `evolution` / `concept-evolution` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `file-evolution` / `file-diff` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `diff` / `semantic-diff` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `change-points` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `file-change-points` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| `cluster-change-points` | ✓ | — | — | — | — | ✓ | ✓ | — |
| **Blame & Attribution** |
| `semantic-blame` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `author` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `experts` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `contributor-profile` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| **Clustering & Organization** |
| `clusters` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `cluster-diff` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| `cluster-timeline` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| **Branch & Merge** |
| `branch-summary` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| `merge-audit` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `merge-preview` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Quality & Metrics** |
| `health` | ✓ | — | — | — | ✓ | ✓ | ✓ | — |
| `debt` | ✓ | — | — | — | ✓ | ✓ | ✓ | — |
| `security-scan` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `doc-gap` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `eval` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| **Impact & Dependencies** |
| `impact` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `co-change` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `deps` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `cycles` | ✓ | — | — | — | — | ✓ | ✓ | — |
| **Graph & Structure** |
| `graph build` | ✓ | — | — | — | — | ✓ | — | — |
| `graph callers` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| `graph callees` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| `graph neighbors` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| `graph path` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `graph relate` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `graph similar` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `graph unused` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `blast-radius` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `hotspots` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Workflow & CI** |
| `triage` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `policy-check` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `regression-gate` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `code-review` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `pr-report` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `cherry-pick-suggest` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `workflow` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| **Narrative & Analysis** |
| `narrate` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| `explain` | ✓ | — | — | ✓ | — | ✓ | ✓ | ✓ |
| `guide` | ✓ | — | — | — | ✓ | ✓ | ✓ | — |
| **Indexing & Maintenance** |
| `index` | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `index start` | ✓ | — | — | — | ✓ | ✓ | ✓ | — |
| `index doctor` | ✓ | — | — | — | — | ✓ | — | — |
| `index vacuum` | ✓ | — | — | — | — | ✓ | — | — |
| `index rebuild-fts` | ✓ | — | — | — | — | ✓ | — | — |
| `index backfill-fts` | ✓ | — | — | — | — | ✓ | — | — |
| `index update-modules` | ✓ | — | — | — | — | ✓ | — | — |
| `index gc` | ✓ | — | — | — | — | ✓ | — | — |
| `index clear-model` | ✓ | — | — | — | — | ✓ | — | — |
| `index build-vss` | ✓ | — | — | — | — | ✓ | — | — |
| **Configuration & Setup** |
| `status` | ✓ | — | — | — | ✓ | ✓ | ✓ | — |
| `config` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `models` | ✓ | — | — | — | — | ✓ | — | — |
| `repos` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `auth` (login/logout/whoami/token */create-user) | ✓ | — | — | — | — | ✓ | — | — |
| `orgs` (create/list/members */`users` create/list) | ✓ | — | — | — | — | ✓ | — | — |
| `repos grant/grants/revoke/move-to-org` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `repos visibility` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `auth sso link/unlink/list` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `audit log` | ✓ | — | — | — | — | — | — | — |
| `admin models` (list/allow/deny/reset) | ✓ | — | — | — | — | — | — | — |
| `quickstart` / `setup` | ✓ | — | — | — | — | ✓ | ✓ | — |
| **Visualization** |
| `map` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `heatmap` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `project` | ✓ | — | — | — | — | ✓ | ✓ | — |
| **Protocols & Servers** |
| `tools serve` | ✓ | — | — | — | — | ✓ | — | — |
| `tools mcp` | ✓ | — | — | — | — | ✓ | — | — |
| `tools lsp` | ✓ | — | — | — | — | ✓ | — | — |
| **Multi-Repo** |
| `multi-repo-search` | — | — | ✓ | ✓ | ✓ | — | — | ✓ |
| `cross-repo-similarity` | ✓ | — | — | — | — | ✓ | ✓ | — |

### LSP Interface Details

**LSP is a specialized protocol for IDE integration, not a general command interface.** It exposes 9 JSON-RPC request/response methods, plus one server-push notification:

| Method | Maps To | Use Case |
|---|---|---|
| `textDocument/hover` | `search` (semantic matching) + debt/health/graph (Phase 115 enrichment) | Show top-5 semantic matches, plus optional Temporal/Risk & quality/Structure sections when their data is available |
| `textDocument/definition` | `graph` (structural-first, Phase 114) + `code-search` (symbol + semantic fallback) | Go-to-definition: exact structural match when the graph is built → exact name match → substring match → semantic fallback (fallback results tagged `tags: ['fallback']`) |
| `textDocument/references` | `graph` (structural-first, Phase 114) + `search`/FTS (symbol + text fallback) | Find all references: exact structural callers/importers when the graph is built → symbol definitions + text mentions (fallback results tagged `tags: ['fallback']`) |
| `textDocument/documentSymbol` | Symbol index | List all symbols (functions, classes, etc.) in the current document |
| `workspace/symbol` | `code-search` (symbol search) | Workspace-wide symbol search by name pattern |
| `textDocument/prepareCallHierarchy` | `graph` (Phase 114) | Resolve a symbol to a `CallHierarchyItem` (carries the graph node key in `data`) |
| `callHierarchy/incomingCalls` | `graph callers` (Phase 114) | Direct (depth-1) callers of a symbol, via the `calls` edge type |
| `callHierarchy/outgoingCalls` | `graph callees` (Phase 114) | Direct (depth-1) callees of a symbol, via the `calls` edge type |
| `textDocument/codeLens` | `graph callers` + `debt-score` (Phase 115) | Per-symbol `Called N× · debt X.XX` annotations, read from the background analysis cache |

**Server-push notification (not request/response, not remote-delegatable):**
- `textDocument/publishDiagnostics` — flags high-debt (`debtScore ≥ 0.7`) / high-hotspot-risk (`hotspotRisk ≥ 0.6`) files on a background timer; opt-in via `gitsema tools lsp --diagnostics` (off by default); **not supported with `--remote`**, since Phase 113's remote-delegation mechanism is request/response-only and has no way for the remote server to push notifications back to a local client (Phase 115). **Supported with `--websocket`** (Phase 116) — WebSocket carries server push fine, so this gating is keyed only on `--remote`, not on the client-facing transport.

**Transports (Phase 113/116/117):** see §0 for the full local-vs-network breakdown of `tools mcp`/`tools lsp` transports and their auth. None of those transports change the capability surface tracked in the tables above — they're alternative ways to reach the same JSON-RPC methods/MCP tools.

**Marked as available in LSP:**
- `search` ✓ — hover operation uses semantic search
- `code-search` ✓ — workspace/symbol and definition use symbol search
- `graph` (partial) ✓ — definition/references/call-hierarchy/codeLens methods query the structural graph first when built (Phase 114/115), falling back to semantic/FTS otherwise
- `debt-score` (partial) ✓ — hover's Risk & quality section and codeLens read debt scores from the Phase 115 background analysis cache

**Not available in LSP:**
- All analysis commands (`evolution`, `clusters`, `change-points`, etc.) — LSP is read-only navigation, not analysis
- All workflow/CI commands — LSP has no mutation or complex orchestration
- All maintenance commands — Not applicable to IDE integration

### Parity Observations

**Complete parity (available in 5+ interfaces, counting LSP):**
- `search`, `code-search`, `index`, `first-seen`, `evolution`, `clusters`, `merge-audit`, `merge-preview`

**CLI-only gaps (not in Guide/MCP):**
- `index doctor`, `graph path`, `graph relate`, `graph similar`, `graph unused`, `blast-radius`, `regression-gate`, `code-review`, `pr-report`, `cherry-pick-suggest`, `co-change`, `deps`, `cycles`, and all maintenance subcommands
- `search --merge-levels` / distinct per-level result lists (Phase 136): the CLI's `search` command is the only interface where combining 2+ of `--chunks`/`--level symbol`/`--level module` at once (or a Phase 77 model-level-fallback union) returns separate labeled per-level lists by default, with `--merge-levels` opting back into one shared-cutoff list. The MCP `semantic_search` tool and the HTTP `search` route can still hit the same multi-level-active condition (e.g. `level: 'symbol', chunks: true`) but only expose the pre-Phase-136 single merged-list behavior — no equivalent flag/param was added to either, since both have their own independent, simpler result-shape (MCP returns a rendered text blob; HTTP returns a flat JSON array) that would need a compatible-breaking shape change to carry labeled per-level lists. Deferred rather than done partially; see `docs/PLAN.md` Phase 136.
- **`code-search` never received Phase 136's per-level-list treatment at all, in any interface** (found during the Phase 136 parity audit). CLI `code-search` (`src/cli/commands/codeSearch.ts`), MCP `code_search` (`src/mcp/tools/search.ts`), and Guide's `code_search` tool (`src/core/narrator/guideTools.ts`) each call `vectorSearch()` with `searchChunks`/`searchSymbols` set from a `level` argument the same way `search` used to pre-Phase-136 — one shared-cutoff merged call, no isolation, no `--merge-levels`-equivalent. This is more exposed than `search`'s gap: CLI `code-search`'s and MCP/Guide `code_search`'s **default** `level`/parameter value is `'symbol'`, which sets `searchChunks: true` *and* `searchSymbols: true` simultaneously — so every default, no-flags invocation of `code-search` hits the exact crowding-out condition Phase 136 fixed for `search`, not just an opt-in flag combination. Not fixed here; added to §6 roadmap.

**HTTP gaps:**
- Most graph commands (`callers`, `callees`, `neighbors`, `path`, `relate`, `similar`, `unused`)
- `code-search`, `file-change-points`, `cluster-diff`, `cluster-timeline`, `branch-summary`, `contributor-profile`, `eval`, `regression-gate`, `code-review`, `pr-report`, `cherry-pick-suggest`

**LSP gaps (expected — LSP is for IDE navigation only):**
- All analysis commands, workflow/CI, maintenance, visualization, configuration
- LSP provides read-only symbol navigation and semantic hover, not high-level analysis

---

## 2. Flag Implementation & Coherence

This section documents all flags used across CLI commands, their consistency, and coverage.

### 2.1 General/Shared Flags (Across Multiple Commands)

| Flag | Short | Type | Default | Used By | Notes |
|---|:---:|---|:---:|---|---|
| `--top` | `-k` | int | varies | `search`, `first-seen`, `code-search`, `triage`, `eval`, `pr-report`, `experts`, `etc.` | Result limit; should be standardized to default=10 across all |
| `--model` | — | string | env | `search`, `first-seen`, `code-search`, `index start` | Override embedding model for current command |
| `--text-model` | — | string | env | `search`, `first-seen`, `code-search`, `index start` | Override text/prose embedding model |
| `--code-model` | — | string | env | `search`, `first-seen`, `code-search`, `index start` | Override source-code embedding model |
| `--remote` | — | string | env | `search`, `first-seen`, `index start`, `tools mcp`, `tools lsp` | Proxy to remote gitsema server; for `tools mcp`/`tools lsp` (Phase 113) this delegates every data-access call via `POST /api/v1/protocol/:operation` instead of indexing/searching against a remote DB directly |
| `--remote-key` | — | string | env (`GITSEMA_REMOTE_KEY`) | `tools mcp`, `tools lsp` | Bearer token for `--remote` |
| `--remote-timeout` | — | int (ms) | `10000` | `tools mcp`, `tools lsp` | Abort a remote-delegated call after this many ms |
| `--websocket` | — | `<bind-address>` | — | `tools mcp`, `tools lsp` | Network transport (raw WebSocket) on a fixed `/mcp`/`/lsp` path — inbound exposure, distinct from `--remote` (see §0) |
| `--http` | — | `<bind-address>` | — | `tools mcp` | Streamable HTTP network transport on a fixed `/mcp` path (Phase 117) — MCP's standard network transport, preferred over `--websocket` |
| `--tcp` | — | `<port>` | — | `tools lsp` | **Deprecated** (Phase 120) raw TCP network transport, `Content-Length`-framed — **no `--key`/auth option**, raw TCP has no header to carry a token in (see §0); use `--websocket --key` instead |
| `--key` | — | string | env (`GITSEMA_WEBSOCKET_KEY`/`GITSEMA_MCP_HTTP_KEY`/`GITSEMA_SERVE_KEY`, transport-dependent) | `tools mcp --websocket\|--http`, `tools lsp --websocket`, `tools serve` | Bearer token required of inbound network clients; not supported by `--tcp` |
| `--branch` | — | string | — | `search`, `first-seen`, `code-search`, `evolution`, `index start` | Restrict to commits reachable from branch |
| `--hybrid` | — | bool | false | `search`, `first-seen`, `code-search` | Blend vector similarity with BM25 keyword matching |
| `--bm25-weight` | — | float | 0.3 | `search`, `first-seen`, `code-search` | Weight for BM25 signal in hybrid search |
| `--before` | — | date | — | `search`, `evolution`, `pr-report`, `ownership` | Temporal filter: blobs first seen before this date |
| `--after` | — | date | — | `search`, `evolution`, `pr-report`, `ownership` | Temporal filter: blobs first seen after this date |
| `--since` | — | date | — | `search`, `evolution`, `file-evolution`, `index start` | Alias for `--after` (search) or resume point (index) |
| `--until` | — | date | — | `search`, `evolution`, `pr-report` | Alias for `--before` |
| `--dump` | — | [string] | — | `search`, `first-seen`, `triage`, `policy-check`, `code-review`, etc. | Legacy JSON output flag; prefer `--out` |
| `--out` | — | string[] | — | `search`, `first-seen`, `triage`, `policy-check`, `code-review`, etc. | Modern unified output spec: `text\|json[:file]\|html[:file]\|markdown[:file]` |
| `--html` | — | [string] | — | `search`, `first-seen`, `eval` | Legacy interactive HTML output; prefer `--out html` |
| `--narrate` | — | bool | false | `triage`, `ownership`, `narrate`, `guide` | Generate LLM narrative summary (requires `GITSEMA_LLM_URL`) |
| `--vss` | — | bool | false | `search`, `first-seen` | Use usearch HNSW ANN index for approximate search |
| `--format` | — | enum | text | `regression-gate`, `cross-repo-similarity`, `code-review` | Output format: `text` or `json` (legacy; prefer `--out`) |
| `--dry-run` | — | bool | false | `index gc`, `storage migrate` | Preview changes without applying them |
| `--verbose` | — | bool | false | top-level flag, `index update-modules`, `index gc` | Enable verbose debug logging |
| `--yes` | `-y` | bool | false | `index rebuild-fts`, `index clear-model` | Skip confirmation prompts |
| `--no-headings` | — | bool | false | `search`, `first-seen` | Don't print column header row |
| `--explain` | — | bool | false | `search`, `repl` | Show score component breakdown for each result |
| `--vss` | — | bool | false | `search`, `first-seen` | Use vector search index for approximate search |
| `--level` | — | enum | file | `search`, `code-search`, `repl` | Search/index granularity: `file`, `chunk`, `symbol`, or `module` |
| `--chunker` | — | enum | file | `index start` | Chunking strategy: `file`, `function`, or `fixed` |
| `--lens` | — | enum | hybrid | `blast-radius`, `relate`, `similar`, `hotspots` | Structural/semantic lens toggle: `structural`, `semantic`, `hybrid` |
| `--depth` | — | int | varies | `deps`, `graph callers`, `graph callees`, `graph neighbors`, `graph path`, `blast-radius` | Traversal depth for graph commands |
| `--repos` | — | string | — | `search`, `first-seen` | Comma-separated repo IDs for multi-repo mode |
| `--threshold` | — | float | varies | `code-review`, `cross-repo-similarity`, `policy-check` | Similarity/distance threshold for matching |
| `--base` | — | ref | varies | `regression-gate`, `code-review`, `ci-diff` | Base git ref to compare from |
| `--head` | — | ref | varies | `regression-gate`, `code-review`, `ci-diff` | Head git ref to compare to |

### 2.2 Command-Specific Flags

This table shows less common flags used by specific commands or command groups.

| Flag | Used By | Type | Default | Purpose |
|---|---|---|:---:|---|
| `--recent` | `search`, `semantic-diff` | bool | false | Blend cosine similarity with recency score |
| `--alpha` | `search`, `semantic-diff` | float | 0.8 | Weight for cosine similarity in blended score |
| `--weight-vector` | `search`, `semantic-diff` | float | 0.7 | Vector similarity weight in three-signal ranking |
| `--weight-recency` | `search`, `semantic-diff` | float | 0.2 | Recency weight in three-signal ranking |
| `--weight-path` | `search` | float | 0.1 | Path-relevance weight in three-signal ranking |
| `--group` | `search`, `semantic-diff` | enum | — | Collapse results by: `file`, `module`, or `commit` |
| `--chunks` | `search`, `code-search`, `first-seen` | bool | false | Include chunk-level embeddings in results |
| `--include-commits` | `search`, `first-seen` | bool | false | Also search commit message embeddings |
| `--annotate-clusters` | `search` | bool | false | Annotate each result with cluster label |
| `--merge-levels` | `search` | bool | false | Merge active search levels into one shared-cutoff ranked list (pre-Phase-136 behavior) instead of separate per-level lists; only meaningful when 2+ of {chunk, symbol, module} are active at once (Phase 136) |
| `--not-like` | `search` | string | — | Negative example query (subtract from score) |
| `--lambda` | `search` | float | 0.5 | Weight for negative example subtraction |
| `--early-cut` | `search` | int | 0 | Limit candidate pool to n random samples |
| `--explain-llm` | `search` | bool | false | Output LLM-ready provenance citation block |
| `--or` | `search` | string | — | Combine results with another query via OR |
| `--and` | `search` | string | — | Combine results with another query via AND |
| `--expand-query` | `search` | bool | false | Expand query with top BM25 keywords before embedding |
| `--concurrency` | `index start` | int | 4 | Parallel embedding calls |
| `--ext` | `index start` | string | — | Only index files with these comma-separated extensions |
| `--max-size` | `index start` | size | 200kb | Skip blobs larger than this |
| `--exclude` | `index start` | string | — | Skip paths containing these comma-separated patterns |
| `--include-glob` | `index start` | string | — | Only index files matching these glob patterns |
| `--window-size` | `index start` | int | 1500 | Target chunk size (chars) for fixed chunker |
| `--overlap` | `index start` | int | 200 | Overlap between fixed chunks (chars) |
| `--embed-batch-size` | `index start` | int | 1 | Texts per embedBatch() call |
| `--file` | `index start`, `pr-report` | string[] | — | Index specific file(s) or focus on file in pr-report |
| `--quantize` | `index start` | bool | false | Store embeddings as int8-quantized vectors |
| `--build-vss` | `index start` | bool | false | Build usearch HNSW ANN index after indexing |
| `--auto-build-vss` | `index start` | [int] | — | Build VSS index when blob count exceeds threshold |
| `--allow-mixed` | `index start` | bool | false | Allow indexing with different embed config |
| `--profile` | `index start` | enum | balanced | Preset profile: `speed`, `balanced`, or `quality` |
| `--profile` | `remote-index` | string | — | Named embedding profile to index with on a multi-profile server (Phase 128); pinned forever on that repo's first index — see §2.3 item 7 for the naming collision with `index start`'s `--profile` |
| `--graph` | `index start` | bool | false | Extract structural references for knowledge-graph |
| `--ref1` | `pr-report`, `triage` | ref | HEAD~1 | First ref to compare |
| `--ref2` | `pr-report`, `triage` | ref | HEAD | Second ref to compare |
| `--query` | `pr-report`, `policy-check`, `triage` | string | — | Concept query for analysis |
| `--max-drift` | `policy-check` | float | — | Max allowed concept drift (cosine distance 0–2) |
| `--max-debt-score` | `policy-check` | float | — | Max allowed aggregate debt score |
| `--min-security-score` | `policy-check` | float | — | Min security score threshold |
| `--window` | `ownership` | int | 90 | Days for ownership trend comparison |
| `--repo-a` | `cross-repo-similarity` | path | — | Path to repo A .gitsema/index.db |
| `--repo-b` | `cross-repo-similarity` | path | — | Path to repo B .gitsema/index.db |
| `--diff-file` | `code-review` | path | — | Read diff from patch file instead of git |
| `--lsp` | `index doctor` | bool | false | Only run LSP startup check |
| `--extended` | `index doctor` | bool | false | Run extended pre-flight checks |
| `--fix` | `index doctor` | bool | false | Auto-repair fixable issues (missing FTS content, orphan embeddings) and re-report |
| `--no-cache` | `search` | bool | false | Skip query embedding cache |
| `--cache` | `search` | bool | true | Use query embedding cache |
| `--edge-types` | `deps`, `graph cycles`, `graph neighbors`, `unused` | string | varies | Comma-separated edge types to traverse |
| `--reverse` | `deps` | bool | false | Show dependents instead of dependencies |
| `--direction` | `graph neighbors` | enum | both | Edge direction: `out`, `in`, or `both` |
| `--to` | `storage migrate` | enum | — | Destination backend: `sqlite`, `postgres`, or `qdrant` |
| `--to-path` | `storage migrate` | path | — | Destination SQLite database file |
| `--to-metadata-url` | `storage migrate` | url | — | Destination postgres connection string |
| `--to-vectors-url` | `storage migrate` | url | — | Destination Qdrant http(s):// URL |
| `--to-vectors-api-key` | `storage migrate` | string | — | Qdrant API key |
| `--to-fts-backend` | `storage migrate` | enum | tsvector | FTS backend: `tsvector`, `pg_search`, or `none` |
| `--out` | `index export` | path | gitsema-index.tar.gz | Output bundle file path |
| `--in` | `index import` | path | gitsema-index.tar.gz | Input bundle file path |
| `--ef-construction` | `index build-vss` | int | 200 | HNSW ef_construction parameter |
| `--M` | `index build-vss` | int | 16 | HNSW M parameter |
| `--model` | `index build-vss` | string | — | Build index for this model |
| `--sort-by-date` | `search-history` (MCP only) | bool | false | Sort by first-seen date instead of score |
| `--include-content` | `evolution`, `concept-evolution` | bool | false | Add stored file text in JSON output |
| `--include-commits` | `first-seen` | bool | false | Also search commit messages |

### 2.3 Flag Coherence Issues

**Standardization gaps:**

1. **Output flags:**
   - Multiple legacy formats: `--dump [file]`, `--html [file]`, `--format <fmt>`
   - New unified flag: `--out <spec>` (supporting multiple formats)
   - **Status:** Gradual migration to `--out`; legacy flags still supported for backward compat
   - **Action:** Standardize on `--out` across all commands; keep legacy flags as hidden aliases

2. **Result limit:**
   - Uses `--top` or `-k` with varying defaults (some 5, some 10, some 20)
   - **Status:** Mostly consistent at 10
   - **Action:** Standardize all to `--top 10` with consistent `-k` short flag

3. **Model overrides:**
   - Consistently available: `--model`, `--text-model`, `--code-model`
   - **Status:** ✓ Good coherence

4. **Temporal filtering:**
   - `--before`/`--after` (search) vs. `--since` (index: resume point)
   - Aliases: `--since` and `--until`
   - **Status:** Some confusion with dual meaning of `--since`
   - **Action:** Document clearly; consider `--resume-from` for index

5. **Boolean flags:**
   - No consistent naming (e.g., `--no-cache`, `--no-headings`)
   - **Status:** Mostly clear
   - **Action:** Document pattern; maintain consistency

6. **Threshold flags:**
   - Different names across commands: `--threshold`, `--max-drift`, `--max-debt-score`, `--min-security-score`
   - **Status:** Context-specific, acceptable
   - **Action:** No change needed

7. **`--profile` naming collision (Phase 128):**
   - `index start --profile` selects a local indexing speed/balanced/quality preset; `remote-index --profile` selects a named server-side embedding profile (multi-profile embedding serving, Phase 128) — same flag name, unrelated meaning and value space, on two different commands.
   - **Status:** Acceptable for now — the two commands are never invoked together and each is documented with its own enum/string type, but flag this if a third `--profile` meaning is ever added.
   - **Action:** No change needed yet; reconsider if a future phase needs both concepts on the same command.

---

## 3. Interface-Specific Implementation Notes

### CLI (86 commands)
- **Status:** Complete command set
- **Strengths:** Full feature access, all flags available
- **Gaps:** None by definition
- **Output formats:** `--out` (unified), legacy `--dump`/`--html`/`--format`

### REPL (Interactive Search)
- **Status:** Lightweight search loop only (no `--flag` support)
- **Strengths:** Minimal API surface, good for quick iteration
- **Gaps:** No analysis, clustering, graph, workflow commands
- **Output:** Text-only; no structured output
- **Subcommands:** `:top`, `:level`, `:hybrid`, `:help`, `:quit`

### Guide (Agentic Tool-Calling)
- **Status:** 49 tools registered; up to 5 roundtrips
- **Strengths:** Sophisticated multi-step workflows, LLM-driven
- **Gaps:** No maintenance commands (doctor, vacuum, gc), some graph commands, no visualization
- **Constraints:** Max ~4000 chars per result for token budget
- **Tools:** Defined in `guideTools.ts` with schema definitions and executors

### MCP (Model Context Protocol)
- **Status:** 38 tools exposed for external AI clients
- **Strengths:** Standardized protocol, works with Claude, other AI systems
- **Gaps:** No maintenance commands, some graph commands, no visualization
- **Transports:** stdio (default), `--websocket`, `--http` (Streamable HTTP, Phase 117) — see §0; identical 38-tool surface on all three
- **Remote delegation:** `gitsema tools mcp --remote <url>` proxies every tool call to a `gitsema tools serve`'s `POST /api/v1/protocol/mcp.<toolName>` route (Phase 113) — a separate, outbound-delegation axis from the inbound transport above (see §0)

### HTTP API (`gitsema tools serve`)
- **Status:** ~30 REST endpoints across multiple routes
- **Strengths:** Language-agnostic, browser-accessible, remote delegation
- **Gaps:** Missing graph commands (callers/callees/neighbors), some analysis endpoints
- **Routes:** `search/`, `analysis/`, `evolution/`, `guide/`, `status/`, `graph/`, `commits/`, `blobs/`, `watch/`, `remote/`, `protocol/` (Phase 113 — generic LSP/MCP remote-delegation dispatch)
- **Authentication:** Optional bearer token via `--key`/`GITSEMA_SERVE_KEY`

### CLI Interactive (Planned)
- **Status:** Not yet implemented
- **Proposed:** Interactive CLI with tab completion, inline help, command history
- **Expected surface:** All 85 commands, full flag support, interactive feedback

### Web UI (Planned)
- **Status:** Not yet implemented
- **Proposed:** Browser-based interface for search, analysis, visualization
- **Expected surface:** Most CLI commands (visualization focus), subset of flags

---

## 4. Maintenance & Governance

### When to Update These Tables

Update the parity tables whenever:

1. **A new tool/command is added:**
   - Add row to Tool Parity Matrix
   - Mark available interfaces with ✓
   - Add entry to tool inventory in CLAUDE.md

2. **A tool is removed or deprecated:**
   - Mark as deprecated in table with footnote
   - Document removal in CHANGELOG.md
   - Update features.md

3. **A new interface is enabled:**
   - Add column to Tool Parity Matrix
   - Populate all rows based on support status
   - Update this document's intro

4. **A flag is added, removed, or renamed:**
   - Update §2 (Flags)
   - Document in CHANGELOG.md
   - Update README.md if user-facing

5. **An interface gains/loses tool support:**
   - Update corresponding cell in matrix
   - Document reason (e.g., "phase XYZ pending", "not applicable")
   - File issue or update PLAN.md if a gap

6. **A new network transport is added for an existing interface** (e.g.
   `tools mcp`/`tools lsp` gain another `--flag <bind>` mode):
   - Update §0's table — this is *not* a new Tool Matrix column, since a
     transport doesn't change which tools/methods are reachable
   - Add the bind flag and its auth flag (if any) to §2

### Single Source of Truth

These tables are authoritative. Keep them in sync with:

- `README.md` (commands, flags)
- `docs/features.md` (feature catalog)
- `docs/PLAN.md` (roadmap, phase status)
- `CLAUDE.md` (tool inventory in § Architecture)
- MCP tool registry (`src/mcp/tools/`)
- CLI command registry (`src/cli/register/`)
- HTTP route registry (`src/server/routes/`)

If you find a discrepancy, **update this file first**, then propagate the change.

### Versioning & Releases

- Updates to this file do NOT require a changeset (documentation)
- Updates that affect user-facing tool availability or flags DO require a changeset
- Use `pnpm exec changeset` and reference the parity table in the summary

---

## 5. Historical Parity Milestones

| Phase | Milestone | Impact |
|---|---|---|
| Phase 8+ | Search interface stabilized | Core parity across CLI, REPL, MCP |
| Phase 41 | Multi-repo support added | `repos` command, search `--repos` flag |
| Phase 80+ | Output format unification | `--out <spec>` introduced; legacy `--dump`/`--html`/`--format` kept |
| Phase 91+ | LLM narrator integration | `--narrate` flag added to select commands |
| Phase 101–103 | Pluggable storage backends | `storage` subcommand; no parity impact (internal) |
| Phase 105+ | Symbol-level search | `--level symbol` added; MCP `code_search` tool |
| Phase 106+ | Structural extraction | `index --graph` flag; MCP tools updated |
| Phase 107+ | Knowledge-graph edges | `graph build`, `graph callers/callees`, etc. |
| Phase 108+ | Graph traversal tools | MCP `call_graph`, `graph_neighbors`, `hotspots` |
| Phase 112 | Unified graph UI | `--out html\|markdown` added to `graph neighbors`/`graph path`/`blast-radius`/`relate`/`similar`/`hotspots`; shared `RenderableSubgraph` model renders as a force-graph (HTML) or ASCII tree (text) |
| Phase 116 | MCP/LSP WebSocket transport | `tools mcp --websocket`, `tools lsp --websocket` — no change to tool/method availability, just a network transport (§0) |
| Phase 117 | MCP Streamable HTTP transport | `tools mcp --http` — MCP's standard network transport, supersedes `--websocket` for MCP clients; no change to tool availability (§0) |
| Phase 119 (review10 close-out) | Network-transport resource bounds | Payload/connection/session caps and non-loopback-without-key warnings added to all `--websocket`/`--http`/`--tcp` modes; no parity impact (security hardening, internal) |
| Phase 120 | `tools lsp --tcp` deprecated | No tool/method availability change — `--tcp` still works identically, now prints a deprecation notice on every invocation steering callers to `--websocket --key` (§0); not yet scheduled for removal |
| Phase 129 | Admin-gated enabled sets | New `gitsema admin models list\|allow\|deny\|reset` CLI command (operator-only, no other interface — see Tool Matrix); no flag changes to existing tools |
| Phase 130 | BYOK for narrator/guide | `--byok-http-url`/`--byok-api-key`/`--byok-model`/`--byok-max-tokens`/`--byok-temperature` flags added to `narrate`/`explain`/`guide` (CLI), nested `byok` body field on the matching HTTP routes, flattened `byok_*` fields on the matching MCP tools; no Tool Matrix changes (additive flags on already-listed tools) |
| Future | CLI Interactive | Full CLI with autocomplete, history, interactive UI |
| Future | Web UI | Browser-based dashboard with visualization |

---

## 6. Roadmap: Closing Parity Gaps

### Quick Wins (Phase 111+)

- [ ] Add HTTP endpoint for `code-search`
- [ ] Add MCP tool for `cluster-change-points`
- [ ] Standardize `--out` format across all commands (hide legacy flags)
- [ ] Add `--narrate` to `evolution`, `semantic-diff`, `branch-summary`
- [ ] **Apply Phase 136's per-level-list separation to `code-search` (CLI/MCP/Guide)** — its default `level: 'symbol'` unconditionally merges chunk + symbol candidates into one shared-cutoff call today (see §1 Parity Observations, "CLI-only gaps"), the same crowding-out bug Phase 136 fixed for `search`, but hit on every default `code-search` invocation rather than only an explicit flag combination

### Medium-Term (Phase 112+)

- [ ] Expose graph commands (`callers`, `callees`, `neighbors`) to HTTP API
- [ ] Add `cluster-diff`, `cluster-timeline` to MCP/HTTP
- [ ] Implement CLI Interactive with tab completion and inline help
- [ ] Add missing graph commands to Guide tool registry

### Long-Term (Phase 113+)

- [ ] Beta Web UI with visualization (map, heatmap, project)
- [ ] Full parity across all interfaces (all tools everywhere applicable)
- [ ] Remove `tools lsp --tcp` once downstream clients have migrated to `--websocket` (deprecated, not removed, as of Phase 120 — see §0; tracked in `CLAUDE.md`)

---

**Document Status:** ✓ Current — see the "Last updated" date at the top of this document (single source of truth; do not add a second date elsewhere in this file).  
**Next Review:** When a tool/interface/transport change ships.  
**Maintainer:** jsilvanus@gmail.com
