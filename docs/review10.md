# Code Review 10 — Knowledge Graph Completion, LSP/MCP Network Transports, and review9 Close-Out

This review reflects the repository state at **v0.96.0** (schema **v26**, **1244 passing / 22 skipped / 0 failing**, `pnpm build` clean), covering the **38 commits** landed since [review9](review9.md) (branch point `f31f8bc`). Scope per the repo's review convention: assess everything since the last review, i.e.:

- **Knowledge Graph completion** (Phases 105–112): stable symbol identity, structural extraction, `graph build`, traversal primitives, the `--lens` semantic/structural/hybrid toggle, hotspot/blast-radius fusion, and the unified graph UI (HTML force-graph + CLI subgraph view).
- **LSP & MCP Fleshout Track** (Phases 113–117): remote-delegation plumbing, LSP structural navigation (call hierarchy, diagnostics), and two new network-facing protocol transports — WebSocket and MCP Streamable HTTP.
- **review9 close-out** (Phase 118): verification that all five review9 findings (command injection, redaction gap, silent backend failures, multi-repo session leak, missing health probes) were actually fixed, plus current docs-parity staleness.

Methodology: three parallel audits (knowledge-graph track; LSP/MCP network-transport security; review9 finding-by-finding verification), each citing exact `file:line`, followed by an independent `pnpm install --frozen-lockfile && pnpm build && pnpm test` (1244 passed / 22 skipped, build exit 0) and direct source inspection of the two highest-severity claims before writing them up.

---

## 1) Executive assessment

review9's debt is genuinely cleared, and unusually thoroughly: all five findings were independently re-verified against current source rather than trusted from commit messages, and all five hold up (§5 below). The team's self-reporting in `PLAN.md` (deviation notes for Phases 107–111) was also cross-checked and found accurate — no contradictions between what PLAN.md claims and what the code does, which is a real and uncommon discipline worth calling out.

The new work this cycle adds two genuinely new attack surfaces — raw `WebSocketServer` and MCP Streamable HTTP, both listening on a TCP socket that can be bound to a non-loopback address — and the auth story on both is correctly implemented (timing-safe bearer check, single chokepoint, checked before any tool dispatch). But authentication being correct is not the same as the transport being safe to expose:

1. **Neither new network transport bounds message size or connection count.** No `maxPayload` on either `WebSocketServer`, no body-size limit on the Streamable HTTP listener (unlike `tools serve`'s `express.json({ limit })`), and no cap on concurrent sessions/connections. This is a DoS gap, not an auth bypass, but it's a regression in posture against the existing `tools serve` HTTP server (`§3`).
2. **`--key` is optional with no env-var fallback and no warning when bound to a non-loopback address.** Running `gitsema tools mcp --websocket 0.0.0.0:4242` with no `--key` silently exposes the full 38-tool MCP surface to anyone on that interface — there is no equivalent of `tools serve`'s documented `GITSEMA_SERVE_KEY` convention for these two new flags (`§3`).
3. **The knowledge-graph track is in very good shape.** Traversal depth is clamped server-side everywhere it matters, all graph SQL is parameterized, the HTML force-graph's JSON payload is correctly escaped — the one real gap is an unbounded `topK` on `hotspots` across HTTP/MCP/CLI (`§2`).
4. **Two shell-interpolation sites survive from before the §2 fix landed.** `regressionGate.ts` and `codeReview.ts` still build `git` commands via template-string `execSync`, the exact pattern that was the Critical finding in review9 — currently CLI-only (not reachable from HTTP/MCP), but the same anti-pattern, left unaddressed (`§5.1`).

Priority order: bound the new transports (`§3`) → cap `hotspots` `topK` (`§2.1`) → finish the shell-interpolation cleanup in `regressionGate.ts`/`codeReview.ts` (`§5.1`) → add a non-loopback-without-`--key` warning (`§3.3`) → the lower-severity items below.

---

## 2) Knowledge Graph track (Phases 105–112)

### 2.1 Unbounded `topK` on `hotspots` — network-reachable, no upper bound (Medium)

`src/server/routes/graph.ts:16` — `topK: z.number().int().positive().optional().default(20)` has no `.max()`. Same shape in the CLI (`src/cli/commands/hotspots.ts:48`) and the MCP tool (`src/mcp/tools/graph.ts:99`). `computeHotspots` (`src/core/graph/hotspots.ts:150`) always materializes the full ranked list over `graph.allNodes()`/`allEdges()` and only slices at the end, so the cost is response-size amplification rather than extra compute — a remote caller requesting `topK: 2000000000` gets every file with `risk > 0` serialized in one response. **Fix:** add `.max(500)` (or similar) to the Zod schema on the HTTP route and MCP tool, matching the convention other commands use for `-k/--top`.

### 2.2 `resolveNode()` full-table scan on non-literal lookups (Medium)

`src/core/graph/resolveNode.ts:30-31` — any traversal command (`graph callers/callees/neighbors/path`, `relate`, `similar`, `blast-radius`, and the MCP `call_graph`/`graph_neighbors` tools at `src/mcp/tools/graph.ts:43,74`) called with a bare qualified name pulls **every** graph node into memory and linear-scans for a `displayName` match. Not exploitable beyond ordinary use, but an unbounded-cost lookup on every such call on a large repo — worth indexing `displayName` rather than scanning.

### 2.3 Unbounded recursion depth in cycle detection (Low)

`src/core/graph/cycles.ts:37-61` — `dfs()` is plain JS recursion with no depth cap independent of `MAX_CYCLES = 50` (which bounds reported cycles, not recursion depth). A long acyclic import chain before a cycle closes could stack-overflow Node. No test exercises a large/deep graph to validate this is safe in practice.

### 2.4 Client-side HTML escaper is weaker than the server-side one (Low)

`src/core/viz/htmlRenderer-shared.ts:136-141` (`esc()`, runs in-browser) escapes only `&`, `<`, `>` — not quotes — while `htmlRenderer-graph.ts`'s `escHtml()` (server-side page chrome) quote-escapes. `showDetail()` (`htmlRenderer-graph.ts:158-168`) uses the weaker `esc()` on node `label`/`kind`/`path`/`key`, which ultimately derive from repository file/symbol names — i.e., attacker-controlled if a hostile repo is indexed and its graph UI viewed. Not exploitable today (no attribute-context injection found), but a future edit that places `esc()` output inside an attribute would reintroduce XSS. **Fix:** align `esc()`'s escape set with `escHtml()`'s.

### What's working well

- Traversal depth is clamped server-side via `clampDepth()`/`MAX_GRAPH_TRAVERSAL_DEPTH` (`src/core/storage/sqlite/graphTraversal.ts:13-16`) across every traversal method (`subgraph`, `callers`, `callees`, `neighbors`, `path`) — the most security-relevant control in the track, and it's solid.
- `safeJson()` (`htmlRenderer-shared.ts:40-47`) correctly neutralizes `</script>` and U+2028/2029 injection in the embedded graph-UI JSON payload.
- All graph SQL (`build.ts`, `graphTraversal.ts`) is parameterized — no string-interpolated SQL anywhere in this track.
- `UnsupportedGraphStore`'s fail-loud behavior on the Qdrant profile is consistent across every traversal method, not just the obvious ones.
- CLI ASCII-tree/markdown subgraph rendering marks nodes visited before recursing — cycle-safe by construction.
- PLAN.md's self-reported deviations for Phases 107–109 (external-node key naming, `--weight-structural` not wired into `vectorSearch`) were checked against source and are accurate — no discrepancies found.

---

## 3) LSP & MCP network transports lack resource bounds (HIGH — availability)

Phases 116–117 add two genuinely new network-facing listeners: raw `WebSocketServer` (`src/mcp/webSocketServer.ts`, `src/core/lsp/server.ts`) and MCP Streamable HTTP (`src/mcp/streamableHttpServer.ts`). Authentication on both is sound — `checkBearerAuth()` (`src/core/util/websocket.ts:31-40`, timing-safe) gates every entry point before any session or tool dispatch, and the Streamable HTTP router is mounted behind the existing Express `authMiddleware` for the delegation path (`src/server/app.ts:144,178`). The gap is resource bounding, not auth:

1. **No message-size limit.** `new WebSocketServer({...})` (`webSocketServer.ts:20`, LSP `server.ts:592`) sets no `maxPayload` — `ws`'s default is effectively unbounded. `streamableHttpServer.ts`'s `handleRequest` reads the raw request body with no cap, unlike `tools serve`'s `express.json({ limit })` (`src/server/app.ts:103`, `GITSEMA_MAX_BODY_SIZE`-bounded). An authenticated (or even pre-auth, on the WS handshake) client can send arbitrarily large frames/bodies and exhaust memory.
2. **No connection/session cap.** Neither transport bounds concurrent connections. `streamableHttpServer.ts:23`'s `sessions` map cleans up correctly on graceful close (`onsessionclosed`) and abrupt close (`transport.onclose`, lines 61-70) — that part is solid — but nothing stops unbounded concurrent sessions/connections from being opened in the first place. No rate limiter equivalent to `buildRateLimiter()` (`app.ts:109`) exists on either raw `http.createServer` path.
3. **`--key` is optional with no env-var fallback or non-loopback warning.** `src/cli/commands/tools.ts:63,90` define `--websocket`/`--http --key` as a plain CLI flag; `checkBearerAuth()` treats an absent key as "always allow" (`websocket.ts:32`). There is no `GITSEMA_WEBSOCKET_KEY`/`GITSEMA_MCP_HTTP_KEY` env var and no startup warning when binding to a non-loopback host without `--key` — `gitsema tools mcp --websocket 0.0.0.0:4242` silently exposes the full 38-tool MCP surface to the network. Compare to `tools serve`'s documented `GITSEMA_SERVE_KEY` expectation.
4. **No `Origin` check on WS upgrade.** `webSocketServer.ts`'s `upgrade` handler doesn't inspect `Origin`, which enables cross-site WebSocket hijacking from a browser if the bound address is browser-reachable and the key is absent/known/leaked. Streamable HTTP sets no CORS headers, so it fails closed for browser cross-origin callers by default — lower priority, but worth an explicit allowlist as defense-in-depth.
5. **Pre-existing, not a regression but worth flagging now:** `startLspTcpServer()` (`src/core/lsp/server.ts:548-574`, predates this track) has **no** auth check at all, and this track added substantial new capability (call hierarchy, diagnostics, structural defs) reachable through it.

**Fix:** set `maxPayload` on both `WebSocketServer` instances; enforce a body-size limit on the Streamable HTTP listener (reuse `GITSEMA_MAX_BODY_SIZE`); add a concurrent-connection/session cap; warn loudly at startup when binding non-loopback without `--key` (mirroring the existing `--websocket`-is-non-standard warning); document the unauthenticated `--tcp` LSP gap as a known issue to close.

**What's working well in this track:** the auth chokepoint itself is correct and consistent across all three new entry points; no SQL injection or shell-exec sinks were introduced; `resolveNode.ts`/`structuralNav.ts` use only parameterized statements; structural-first/semantic-fallback precedence (Phase 114) returns `[]` rather than throwing and gates on `isGraphBuilt()` correctly, with no silent merging of exact and approximate results; `analysisCache.ts`'s staleness window is a documented, accepted tradeoff, not a bug; remote delegation (Phase 113) has no command-injection or prototype-pollution sink, though it does trust the remote server's JSON response shape without runtime validation (informational — the design explicitly assumes a trusted remote).

---

## 4) Reusable code / minor inconsistencies

1. `regressionGate.ts`/`codeReview.ts` (see §5.1) duplicate the shell-interpolation anti-pattern that `narrator.ts` was fixed for — same root cause, two more sites.
2. `esc()` vs `escHtml()` (§2.4) is the same "two disciplines for the same job, one weaker" shape review9 flagged for redaction (§3) — worth a lint rule or shared helper so this class of drift stops recurring.
3. No env-var equivalents (`GITSEMA_WEBSOCKET_KEY`, `GITSEMA_MCP_HTTP_KEY`) for the new transports' `--key`, unlike every other auth-bearing surface in the project (`GITSEMA_SERVE_KEY`, `GITSEMA_REMOTE_KEY`). Worth adding for consistency, since config-file/env-var precedence is otherwise uniform across the CLI.

---

## 5) review9 close-out verification (Phase 118)

Each of review9's five findings was independently re-checked against current source (not trusted from commit messages or PLAN.md's "✅ complete" labels):

1. **§2 command injection — VERIFIED FIXED, with a caveat.** `src/core/narrator/narrator.ts` now builds `git log` argv as an array via `execFileSync('git', args, …)` — no shell — and validates `range` through `isSafeGitRange()` (a regex allowlist that rejects leading `-` and shell metacharacters); unsafe ranges are rejected with a warning rather than executed. The HTTP path (`src/server/routes/narrator.ts`) flows through the same function, closing the network vector. **Caveat:** `src/cli/commands/regressionGate.ts:92-93` (`` execSync(`git rev-parse --short ${baseRef}`) ``) and `src/cli/commands/codeReview.ts:97` (`` execSync(`git diff ${base}...${head}`) ``) still interpolate unvalidated strings into a shell command — the identical pattern, just not currently exposed via HTTP/MCP. This should be fixed proactively before either command grows a network-facing route.
2. **§3 redaction gap — VERIFIED FIXED at the chokepoint.** `callLlm()` in `src/core/llm/narrator.ts` now redacts the prompt before sending, so all 11 bespoke `narrate*` functions benefit automatically regardless of whether they pre-redact. `tests/narratorRedactCallLlm.test.ts` exercises this directly.
3. **§4 silent backend failures — VERIFIED FIXED**, via a narrower mechanism than originally proposed: `index --file` now refuses to run on non-sqlite backends (fails loudly) rather than routing through `profile.writeFileBlob` as review9 suggested — so the underlying feature gap (no file-level indexing on Postgres/Qdrant) remains, it's just no longer silent. Postgres/Qdrant `VectorStore.search` now `throw` on `allowedHashes`; module-embedding skips now `logger.warn`.
4. **§7.1 multiRepoSearch leak — VERIFIED FIXED.** `repoRegistry.ts` now wraps the search in `withDbSession` so `vectorSearch` resolves the correct per-repo session, and closes it in a `finally` block — both the wrong-DB bug and the connection leak are addressed.
5. **§7.2 Postgres health probe — VERIFIED FIXED, with Qdrant at parity.** `verifyPgPool()` (`src/core/storage/postgres/connection.ts`) runs a memoized `SELECT 1` on first use with an actionable error message; Qdrant's equivalent `verifyQdrantClient()` predates this and is called from the same call sites.
6. **Docs parity — VERIFIED FIXED.** `CLAUDE.md` documents `storage.*` keys, the full `GITSEMA_STORAGE_*` env table, and `storage info`/`migrate`/`setup`. `docs/features.md`'s banner now matches `package.json` and `CURRENT_SCHEMA_VERSION`, and `tests/docsSync.test.ts` enforces the match mechanically — closing the "this will silently rot again" risk review9 flagged.
7. **Independent current-staleness check — not stale.** `CLAUDE.md` and `docs/parity.md` both reflect Phases 105–118 (knowledge graph, `--lens`, the new MCP graph tools, and both new transports). `feature-ideas.md` references to now-shipped concepts appear only as historical context within a still-open idea, not as un-pruned duplicates.

---

## 6) What is working well (verified, keep doing this)

1. **review9 is fully closed out** — all five findings independently re-verified, not just trusted from commit messages; the one caveat (§5.1) is a residual instance of the same root-cause pattern, not a regression.
2. **The team's own deviation/known-gap notes in PLAN.md are accurate** — every claim checked against source held up, across two independent reviewer passes (knowledge-graph and LSP/MCP tracks). This is a genuinely uncommon level of self-reporting discipline and should be preserved as new phases land.
3. **Auth is a single, consistent, timing-safe chokepoint** across every network-facing surface added this cycle (HTTP routes, WebSocket upgrade, Streamable HTTP) — the gap this review found is resource bounding, not authentication design.
4. **`docsSync.test.ts` now mechanically enforces** the features.md-banner-vs-package.json drift that review8 and review9 both flagged manually — a real structural fix, not just a one-time doc update.
5. **Graph traversal depth-clamping and JSON-escaping in the new viz layer are both done correctly** at every call site checked, not just the obvious ones.
6. **Test suite grew with the features** — 1244 passing (was 1040 at review9), build clean.

---

## 7) Concrete improvement points (priority order)

1. **Bound the new network transports (§3):** `maxPayload` on both `WebSocketServer` instances; a body-size limit on Streamable HTTP (reuse `GITSEMA_MAX_BODY_SIZE`); a concurrent-connection/session cap. *(High — availability, network-reachable.)*
2. **Cap `hotspots` `topK` (§2.1)** on the HTTP route and MCP tool schema (e.g. `.max(500)`). *(Medium.)*
3. **Finish the shell-interpolation cleanup (§5.1):** switch `regressionGate.ts`/`codeReview.ts` to `execFileSync` array form before either gains a network-facing entry point. *(Medium, pre-emptive.)*
4. **Add a non-loopback-without-`--key` startup warning** for `--websocket`/`--http`, plus `GITSEMA_WEBSOCKET_KEY`/`GITSEMA_MCP_HTTP_KEY` env-var fallbacks for consistency with `GITSEMA_SERVE_KEY`. *(Medium.)*
5. **Document (and plan to close) the unauthenticated `--tcp` LSP transport** now that it carries call-hierarchy/diagnostics capability. *(Medium.)*
6. **Index `displayName` lookups in `resolveNode()`** instead of a full `allNodes()` scan (§2.2). *(Low.)*
7. **Align the client-side graph-UI `esc()` with the server-side `escHtml()`'s escape set** (§2.4) as defense-in-depth. *(Low.)*
8. **Add a depth/visited-budget guard to `cycles.ts`'s `dfs()`** independent of `MAX_CYCLES`, plus a test with a large/deep graph (§2.3). *(Low.)*

---

*Methodology: three parallel audits (knowledge-graph track Phases 105–112; LSP/MCP network-transport security Phases 113–117; review9 finding-by-finding verification + current docs-parity check), each citing exact `file:line` against current source; an independent `pnpm install --frozen-lockfile && pnpm build && pnpm test` (1244 passed / 22 skipped, build exit 0); and direct source verification of the two highest-severity claims (WebSocket `maxPayload`/body-size limits, missing `--key` warnings) before inclusion. All five review9 findings were re-verified rather than trusted from commit messages, and PLAN.md's self-reported deviations for Phases 107–111 were cross-checked against source with no discrepancies found.*
