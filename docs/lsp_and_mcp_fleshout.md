# LSP & MCP Fleshout — Development Spec

**Status:** Draft — designed, not yet built. Promote sections to `docs/PLAN.md` phases as they are scheduled.

**Source ideas:** `docs/feature-ideas.md` §"LSP Remote Delegation & Transport", §"LSP WebSocket Transport", §"LSP Structural Navigation", §"LSP Diagnostics & Code Lens", §"MCP Remote Delegation & HTTP Transport", §"Improved LSP Hover with Temporal & Risk Data". The Semahub SaaS layer described in feature-ideas.md is **out of scope** here — this spec covers only the self-hosted gitsema work those ideas depend on (their "Layer 1").

This document turns six undesigned ideas into one coherent, sequenced spec covering both protocol servers (`gitsema tools lsp`, `gitsema tools mcp`). It exists because the two servers currently diverge unnecessarily (LSP has `--tcp`, MCP has nothing; both are stdio-only for queries) and because several ideas share the same remote-delegation plumbing — building them together avoids solving the same problem twice.

---

## 1. Current state (verified against code)

- **LSP** (`src/core/lsp/server.ts`, `src/cli/commands/tools.ts`): JSON-RPC 2.0 over stdio or `--tcp <port>` (raw TCP socket, `node:net`). Handlers: `initialize`, `textDocument/hover`, `textDocument/definition`, `textDocument/references`, `workspace/symbol`, `textDocument/documentSymbol` (per `capabilities` in `initialize`). All handlers query `vectorSearch` against the **local** `getActiveSession()` DB — semantic/fuzzy matching only, no use of `structural_refs`/`graph_nodes`/`edges` (Phase 106–107 tables).
- **MCP** (`src/mcp/server.ts`): `@modelcontextprotocol/sdk` `McpServer` over `StdioServerTransport` only. 38 tools registered across `src/mcp/tools/{search,analysis,clustering,graph,infrastructure,workflow,narrator}.ts`. Every tool handler calls core logic directly against the local DB session — no remote-delegation path exists.
- **HTTP server** (`src/server/app.ts`, Phase 16/101+): already multi-tenant-capable — `authMiddleware` (Bearer token, SHA-256-hashed `repo_tokens` with per-repo scoping), `repoSessionMiddleware`, `requestTimingMiddleware`/Prometheus `metricsRegistry`, rate limiting. Routes exist for search, evolution, all analysis commands, graph, guide, narrator, but **no `/lsp` or `/mcp` routes**.
- **Remote client** (`src/client/remoteClient.ts`): `GITSEMA_REMOTE` + `GITSEMA_REMOTE_KEY` env-based HTTP client used today only by `gitsema index --remote` and `gitsema remote-index`. This is the pattern to extend for LSP/MCP remote delegation, not a new client to invent.
- **Both `gitsema tools lsp` and `gitsema tools mcp` only operate on `.gitsema/index.db` in the current working directory.** There is no flag on either to point at a remote index.

This confirms the feature-ideas.md problem statements are accurate as of this writing.

---

## 2. Design principle: one remote-delegation mechanism, two thin adapters

Per `CLAUDE.md`'s design constraint #5 ("CLI-first... MCP layer is a thin adapter... does not duplicate business logic"), remote delegation must be implemented **once**, as a shared module, and consumed by both `tools lsp` and `tools mcp`. Do not write separate remote-proxy code paths for each protocol.

```
src/core/remote/
  protocolClient.ts   — new: thin wrapper around remoteClient.ts adding
                         generic "call any named operation" support, used by
                         both LSP and MCP remote modes
```

`protocolClient.ts` should expose one function, something like:

```ts
export async function callRemote<T>(opName: string, args: unknown): Promise<T>
```

backed by a new HTTP route (see §3) rather than one bespoke route per LSP method / MCP tool. Both LSP's `handleRequest()` and each MCP tool handler check (at call time, not at server-start time) whether `--remote` was passed; if so they call `callRemote()` instead of querying the local DB session directly. This means the *existing* handler bodies stay mostly intact — only the data-access call at the top of each handler is swapped for a conditional.

---

## 3. Phase A — `--remote` delegation for LSP and MCP

*(feature-ideas.md: "LSP Remote Delegation & Transport" + "MCP Remote Delegation & HTTP Transport" Phase-112 portion)*

### 3.1 CLI surface

```bash
gitsema tools lsp --remote <url> [--remote-key <token>]
gitsema tools mcp --remote <url> [--remote-key <token>]
```

- `--remote <url>`: base URL of a running `gitsema tools serve` instance. Reuses the `GITSEMA_REMOTE`/`GITSEMA_REMOTE_KEY` env var convention already established for `index --remote` — i.e. `--remote`/`--remote-key` flags should fall back to those env vars when omitted, exactly as `index.ts` does today (grep `GITSEMA_REMOTE` in `src/cli/commands/index.ts` for the existing precedence pattern to copy).
- When `--remote` is **not** passed, behavior is byte-for-byte unchanged (local DB session, current code paths).
- Both servers still speak stdio (or `--tcp` for LSP) to the IDE/AI client — `--remote` only changes where the *data* comes from, not the client-facing transport. This is the Phase 112 scope; Phase B below changes the client-facing transport.

### 3.2 New HTTP route

Add one generic route to `src/server/app.ts` / a new `src/server/routes/protocol.ts`:

```
POST /api/v1/protocol/:operation
```

- `:operation` is a namespaced string, e.g. `lsp.hover`, `lsp.definition`, `lsp.references`, `lsp.workspaceSymbol`, `lsp.documentSymbol`, or `mcp.<toolName>` for any of the 38 registered MCP tools.
- Body: `{ args: <opaque JSON params> }`. Response: `{ result: <opaque JSON> }` or a 4xx/5xx with `{ error: string }`.
- Server-side dispatch table maps each `operation` string to the same core function the local handler already calls (e.g. `lsp.hover` → the body of the existing `textDocument/hover` case in `server.ts`; `mcp.semantic_search` → the same function `registerSearchTools` wires into the MCP SDK). **Do not duplicate the logic** — extract each local handler's core call into a plain async function importable from both the stdio path and this route, if it isn't already factored that way.
- Protected by the existing `authMiddleware` + `repoSessionMiddleware` — no new auth mechanism. This satisfies the "Specify authentication model" design gap in feature-ideas.md: the answer is "inherit from the HTTP server," not a new scheme.

### 3.3 Error handling (resolves design gap)

- Network/timeout errors from `callRemote()` surface as:
  - LSP: a JSON-RPC error response (`{ jsonrpc: '2.0', id, error: { code: -32000, message } }`), never a hung request — wrap `fetch` with an `AbortController` timeout (suggest 10s default, configurable via `--remote-timeout <ms>`).
  - MCP: an MCP tool error result (the SDK's standard `isError: true` content shape), so the AI client sees a normal tool failure rather than a transport crash.
- On connect failure at startup (immediate `--remote` health check against `GET /api/v1/status`), both commands should print a clear error and exit non-zero rather than silently falling back to local mode — silent fallback would violate the "no surprising behavior" expectation for a remote-pointing flag.

### 3.4 Tests

- `tests/integration/lspRemote.test.ts`: spin up a real HTTP server (supertest or a real `http.Server` on an ephemeral port) with a temp index, start `handleRequest` in remote mode pointed at it, assert hover/definition/references round-trip correctly and match the local-mode result for the same query.
- `tests/integration/mcpRemote.test.ts`: same pattern for at least 3 representative MCP tools (one search, one analysis, one graph tool) to cover the dispatch table without testing all 38 exhaustively.
- Unit test for `protocolClient.ts`: timeout behavior, auth header inclusion, error propagation shape.

### 3.5 Effort

~500-700 LOC combined (feature-ideas.md estimated LSP ~400-500 + MCP ~200-300 separately; sharing `protocolClient.ts` and the dispatch-table pattern should bring the combined total down, not add them linearly).

---

## 4. Phase B — WebSocket transport (LSP + MCP)

*(feature-ideas.md: "LSP WebSocket Transport" + MCP HTTP/WebSocket Phase-113 portion)*

Depends on Phase A landing first (per feature-ideas.md's stated prerequisite) — WebSocket is a transport for the same remote-delegation calls, not a separate mechanism.

### 4.1 CLI surface

```bash
gitsema tools lsp --websocket <bind-address>   # e.g. 0.0.0.0:4242
gitsema tools mcp --websocket <bind-address>   # e.g. 0.0.0.0:4242
```

- Bind address format matches `--tcp <port>`'s existing convention but allows a host part for explicit interface binding (`0.0.0.0` vs `127.0.0.1`).
- TLS is **not** terminated by gitsema — document that `wss://` requires a reverse proxy (nginx/Caddy) in front, consistent with how `gitsema tools serve` already expects this for HTTPS. This resolves the "TLS handling" design gap without adding a new dependency.
- URI path: fixed at `/lsp` and `/mcp` respectively (no `--path` flag needed for v1 — add one later only if a real multi-tenant routing need appears).
- Use Node's built-in `WebSocket` server only if available in the supported Node version (20+); otherwise add `ws` as a dependency. Check `package.json` engines field and pick accordingly — do not assume.

### 4.2 Message framing

- LSP: same JSON-RPC 2.0 messages as stdio, just framed as individual WebSocket text frames instead of `Content-Length`-prefixed stdio chunks (`serializeMessage`/`parseMessage` in `server.ts` become stdio-only; WebSocket path sends/receives raw JSON per frame).
- MCP: the `@modelcontextprotocol/sdk` may already ship a WebSocket-compatible transport — check the installed SDK version's exports before hand-rolling one. If it doesn't, implement a minimal `Transport` per the SDK's `Transport` interface (mirrors `StdioServerTransport`'s shape).

### 4.3 Auth

- Optional Bearer token via `Sec-WebSocket-Protocol` header or an initial auth frame (`{ type: 'auth', token }`) before any RPC traffic is accepted — pick the header approach for parity with how `authMiddleware` already reads `Authorization: Bearer`, since most WS client libraries support custom headers on the handshake request more readily than a subprotocol token.

### 4.4 Tests

- `tests/integration/lspWebsocket.test.ts`, `tests/integration/mcpWebsocket.test.ts`: connect a real `ws` client, exercise hover/search round-trip, assert auth rejection when token is wrong/missing.

### 4.5 Effort

~600-800 LOC combined (feature-ideas.md: LSP ~200-300 + MCP ~400-500).

---

## 5. Phase C — LSP structural navigation

*(feature-ideas.md: "LSP Structural Navigation")*

Independent of Phases A/B — can be built in parallel since it only changes *what data* local (or remote-delegated) LSP handlers query, not transport.

### 5.1 Behavior change

- `textDocument/definition` / `references` / new `callHierarchy/incomingCalls` / `callHierarchy/outgoingCalls`: when the target file's blob has rows in `structural_refs`/`graph_nodes`/`edges` (Phase 106–107 tables — TS/TSX/JS/Python only), prefer exact structural resolution over semantic search. Fall back to today's semantic-search behavior when:
  - the graph hasn't been built (`gitsema graph build` never run — check `graph_nodes` row count or a `graph_build_meta` marker if one exists),
  - the language isn't one of the four supported, or
  - the structural lookup returns zero results for this specific symbol (e.g. an external/untyped symbol).
- Reuse `src/core/graph/traversal.ts` and `src/core/storage/types.ts`'s `GraphStore` interface directly — these already implement typed BFS/CTE-based callers/callees/neighbors lookups for `graph callers`/`graph callees`/`graph neighbors`. Do not write new graph-query SQL in `lsp/server.ts`; call the existing traversal functions.

### 5.2 New capability advertised

```ts
capabilities: {
  ...
  callHierarchyProvider: true,   // new
}
```

### 5.3 Precedence rule (resolves design gap)

Structural result first, semantic result appended as `tags: ['fallback']`-style secondary context only if structural lookup found nothing — never silently merge the two into one ranked list, since structural matches are exact and semantic matches are approximate; conflating them would mislead "Go to Definition" users.

### 5.4 Tests

- `tests/lspStructural.test.ts`: build a small graph fixture (reuse the same fixture pattern as `tests/graphTraversal.test.ts` if one exists — check first), assert `callHierarchy/incomingCalls` returns exact callers, and assert graceful fallback to semantic search when no graph exists for the given blob.

### 5.5 Effort

~300-400 LOC (per feature-ideas.md estimate; unchanged since it doesn't interact with Phase A/B).

---

## 6. Phase D — LSP diagnostics, code lens, and rich hover

*(feature-ideas.md: "LSP Diagnostics & Code Lens" + "Improved LSP Hover with Temporal & Risk Data" — combined here because both are "attach more analysis data to existing LSP surfaces" and share the same data-joining code)*

### 6.1 Hover enrichment

Extend `textDocument/hover`'s Markdown response to optionally include, behind graceful-degradation checks (each section omitted if its data source is unavailable — never error the whole hover):

- **Temporal:** last-touched author + date, change frequency (`blob_commits` join — same query shape as `experts`/`ownership` commands).
- **Risk & quality:** debt score (Phase 104+ `debt` command's scoring function, called directly, not re-implemented), hotspot risk (Phase 110 `hotspots`), security pattern count (`security_scan`'s underlying function).
- **Structure:** caller/callee counts (Phase C above, if available).

Build this as a single `buildHoverMarkdown(blobHash, symbol)` function in `src/core/lsp/hoverContent.ts` that the existing `textDocument/hover` handler calls — keep `server.ts`'s JSON-RPC plumbing free of analysis logic, consistent with the "MCP/LSP layer is a thin adapter" constraint.

### 6.2 Diagnostics (new capability)

- `textDocument/publishDiagnostics` notifications (server-initiated, not request/response) flagging high-debt or high-hotspot-risk functions inline, e.g. "High hotspot risk: touches 5 modules, called 200×/month."
- Computed on a background timer (suggest every 5 minutes, or on file-save notification if the client sends `textDocument/didSave`) and cached — **never compute hotspots/debt synchronously inside a hover request**, since those analyses scan substantial history and would make hover laggy. This resolves the "Performance under load" design gap directly: caching plus background computation is the answer, not request-time computation.

### 6.3 Code Lens (new capability)

- `textDocument/codeLens`: inline annotations like "Called 42 times · Last touched 2h ago" above function definitions. Same cached-metrics backing as diagnostics.

### 6.4 Design gap resolutions

- **Hover content structure/prioritization:** order is Semantic → Temporal → Risk & Quality → Structure (most universally available/cheap first, most graph-dependent last) — matches the example in feature-ideas.md.
- **False positive rate for diagnostics:** ship hotspot/debt diagnostics behind a `--diagnostics` opt-in flag on `tools lsp` initially (default off) until real-world false-positive rate is observed; promote to default-on in a later phase if warranted.

### 6.5 Tests

- `tests/lspHover.test.ts`: assert each optional section appears/disappears correctly based on data availability (no graph → no Structure section; no commits → no Temporal section, etc.)
- `tests/lspDiagnostics.test.ts`: assert background cache populates and `publishDiagnostics` notification shape is correct; assert `--diagnostics` flag gates the feature.

### 6.6 Effort

~350-500 LOC combined (feature-ideas.md: hover ~150-200 + diagnostics/codelens ~200-300 per type, scoped here to one combined diagnostic type for v1).

---

## 7. Sequencing and dependencies

```
Phase A (remote --remote flag, both protocols)
   │
   ├──> Phase B (WebSocket transport, both protocols)   [depends on A]
   │
   ├──> Phase C (structural navigation)                  [independent of A/B,
   │                                                       requires Phase 107 graph]
   │
   └──> Phase D (diagnostics/codelens/rich hover)         [independent of A/B,
                                                            benefits from C for
                                                            the Structure hover
                                                            section, but degrades
                                                            gracefully without it]
```

Recommended build order: **A → C → D → B**. Rationale: A unblocks the strategic remote-MCP foundation (feature-ideas.md flags this as the Semahub prerequisite, so it has the highest external leverage); C and D are independent value-adds that don't block or get blocked by anything except the already-complete Phase 107 graph; B is the most speculative (no concrete user request yet, mainly "future-proofing for browser IDEs") and most safely deferred.

---

## 8. Cross-cutting governance checklist

Per root `CLAUDE.md`, each phase above (A, B, C, D) when implemented must:

1. Add the feature to `docs/features.md` under the MCP/LSP or appropriate group.
2. Update `README.md` command/option tables for any new `tools lsp`/`tools mcp` flags (`--remote`, `--remote-key`, `--remote-timeout`, `--websocket`, `--diagnostics`).
3. Mark the corresponding phase complete in `docs/PLAN.md` (these phases aren't numbered yet — assign the next available phase numbers when scheduling, and note this spec file as the design source).
4. Update `docs/parity.md` — this is the most directly affected canonical doc here, since all four phases change LSP/MCP capability surfaces that parity.md tracks explicitly (see its "LSP Interface Details" section referenced in feature-ideas.md).
5. Add a changeset (`minor` bump) per phase — these are all user-facing capability additions.
6. Follow ESM/`.js`-import, strict-TypeScript, no-barrel-export, `p-limit`-throttled-embedding conventions already in force; no new conventions needed.
7. Run `pnpm build && pnpm test` before considering any phase done.

---

## 9. Explicitly out of scope here

- Semahub (auth/billing/multi-tenancy SaaS layer) — `feature-ideas.md`'s "Semahub" section is a separate product built *on top of* Phase A/B once they exist; no gitsema-side work for it is specified in this document.
- `gitsema auth login`/`logout`/`token` commands — feature-ideas.md mentions these as Semahub-adjacent convenience wrappers; they are not required for Phase A (`--remote-key`/`GITSEMA_REMOTE_KEY` already cover authentication without a credential-management subsystem). Revisit only if a concrete self-hosted multi-user need emerges.
