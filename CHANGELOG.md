# gitsema

## 0.98.0

### Minor Changes

- 1767bff: Phase 153: Add `blob:` prefix to blob hashes in all text outputs (CLI, MCP, HTTP) so they are clearly distinguishable from commit hashes. HTML renderers now show "Blob Hash" column headers and `blob:`/`commit:` prefixes. OpenAPI `blobHash` field description updated for clarity. MCP tool interpretations for `semantic_search`, `search_history`, and `first_seen` updated to guide LLMs on hash types.

### Patch Changes

- d06182f: Security (Phase 150 / review11 §2.1 + §3.2): close the network-reachable git
  argument-injection sink. A caller-supplied "ref" beginning with `-` (e.g.
  `--output=/path`) was parsed by git as a _flag_, turning `git log` into an
  arbitrary-file-write primitive reachable via `semantic_bisect`/`triage`. All
  git call sites that take a user-influenced ref now route through a shared
  `runGit()` helper that rejects leading-`-` refs before spawning git and always
  inserts git's `--end-of-options` separator so a value can never be read as a
  flag (`resolveRefToTimestamp`, `parseDateArg`, `getMergeBase`,
  `getBranchExclusiveBlobs`).
- 842be12: Security (Phase 151 / review11 §2.2): enforce repo authorization on read
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
- 6bf15d8: Security (Phase 152 / review11 §3.1 + §3.3). **BYOK SSRF guard:** on
  `tools serve`, a caller-supplied `byok.http_url` is now validated before the
  server calls it — non-`http(s)` schemes and hosts resolving to loopback,
  link-local (incl. the `169.254.169.254` cloud-metadata IP), or RFC-1918
  private ranges are rejected by default. Operators re-permit specific internal
  hosts (e.g. a local model server) via the new `GITSEMA_BYOK_ALLOW_HOSTS`
  allowlist. This is a behavior change for anyone pointing BYOK at a
  `localhost`/private endpoint — add the host to the allowlist. **List-tool
  bounds:** the network-exposed `deps` and `blast_radius` `depth` parameter is
  now upper-bounded (max 64) on both the HTTP route and MCP tool, closing the
  last unbounded traversal-depth input from the Phase 147/148 exposure.

## 0.97.0

### Minor Changes

- e7fefea: Add superadmin-controlled model allow-lists and bring-your-own-key (BYOK) support. Operators can now restrict which embedding profiles or narrator/guide model configs are usable, server-wide or per-org, via `gitsema admin models list|allow|deny|reset --kind <embedding|narrator|guide> [--org <name>]`. Independently, `narrate`/`explain`/`guide` (CLI, HTTP, and MCP) accept request-scoped BYOK credentials (`--byok-http-url`/`--byok-api-key`/`--byok-model`/`--byok-max-tokens`/`--byok-temperature` and equivalent HTTP/MCP fields) that bypass the allow-list entirely and are never persisted.
- 0cd2676: Phase 143: closed a grab-bag of small HTTP/CLI flag-parity gaps across `src/server/routes/analysis.ts`. `POST /analysis/merge-audit` gained `base` (merge-base override); `POST /analysis/merge-preview` gained `top`/`iterations`/`edgeThreshold`/`enhancedKeywordsN`/`useEnhancedLabels`; `POST /analysis/branch-summary` gained `enhancedLabels`/`enhancedKeywordsN` (slices `nearestConcepts[].topKeywords` in the JSON response); `POST /analysis/clusters` gained `iterations`/`edgeThreshold`/`enhancedKeywordsN`; `POST /analysis/security-scan` gained `highConfidenceOnly`; `POST /analysis/impact` gained `chunks`/`level`/`lens` (`structural`/`hybrid` now makes it a thin `blast-radius` alias, closing a prior silent divergence from the CLI's default); `POST /analysis/semantic-diff` gained `hybrid`/`bm25Weight` (also fixing a pre-existing CLI bug where `diff`'s `--hybrid`/`--bm25-weight` flags were declared but never wired to anything); `POST /analysis/semantic-blame` gained `level` (file/symbol).
- d0c8389: The HTTP API's `clusters`, `change-points`, `author`, `impact`, `semantic-diff`, `semantic-blame`, `triage`, and `workflow` analysis routes now accept the same `model`/`textModel`/`codeModel` embedding overrides already available as `--model`/`--text-model`/`--code-model` on their CLI equivalents, via a new shared request-scoped resolver.
- 418779b: Add an identity/authorization audit log: sensitive actions (grant create/revoke, token create/revoke, login success/failure, org membership changes, repo org moves) recorded on the HTTP auth/orgs routes and queryable via `gitsema audit log [--org] [--repo] [--limit]`. Completes the Multi-Tenant Auth Track (Phases 122-125).
- 887c2dc: `POST /analysis/author` (HTTP API) now supports the full `gitsema author` CLI flag surface: `since`, `detail`, `includeCommits`, `hybrid`, and `bm25Weight` are wired through to the same author-attribution logic the CLI uses, plus `chunks`/`level`/`vss` are accepted for flag-surface parity (no-op, matching the CLI's own behavior for these three). Breaking change: the response shape is now `{ authors, commits? }` instead of a bare array, to carry `includeCommits` results.
- 18c9518: `gitsema code-search` now isolates its chunk and symbol candidate pools by default, returning them as separate, independently-ranked result lists instead of one shared-cutoff merged ranking — the default `--level symbol` was combining both pools on every call, which could let a file whose best evidence was chunk-framed get crowded out by symbol-framed matches (or vice versa) purely from embedding-framing bias. Pass `--merge-levels` to opt back into the previous single merged list. The MCP `code_search` tool and Guide's `code_search` tool adopt the same per-level separation, returning a `results_by_level` object (keyed by `file`/`chunk`/`symbol`) instead of a flat `results` array when multiple levels are active — a breaking response-shape change for existing callers, both of which gained a `merge_levels` parameter to opt back into the flat shape.
- 4be4523: `gitsema search` now returns distinct, independently-ranked result lists per search level (file/chunk/symbol/module) by default whenever two or more of `--chunks`/`--level symbol`/`--level module` are active at once — e.g. `--chunks --level symbol`, or a per-model saved-level mismatch — instead of merging every level into one shared-cutoff ranked list where a weaker level's matches could be crowded out entirely. Text output renders one labeled section per level; `--out json` emits a `resultsByLevel` object keyed by level. Pass `--merge-levels` to opt back into the previous single merged list. A single active level (the common case) is unaffected.
- 83b3de6: Add `gitsema index doctor --fix`: automatically backfills missing FTS5 content and garbage-collects orphan embeddings when those issues are detected, then re-reports index health — no need to run `index backfill-fts`/`index gc` separately.
- c8a6bd9: `POST /evolution/file` now accepts `level` (`file`/`symbol` per-symbol centroid evolution), `branch`, `model`/`textModel`/`codeModel` overrides, and `alerts` (top-N largest semantic jumps with author/commit), matching the CLI's `file-evolution` flag surface. `POST /evolution/concept` gains `branch` and model overrides, matching `evolution`/`concept-evolution`. `POST /graph/hotspots` gains `weightStructural`, matching CLI's `--weight-structural`. Branch filtering is now threaded through the core `computeEvolution()`/`computeConceptEvolution()` functions rather than being CLI-only.
- 37c9866: The `graph` command family (`callers`, `callees`, `neighbors`, `path`, `relate`, `similar`, `unused`, `cycles`, `deps`, `co-change`, `blast-radius`) is now exposed over HTTP (`POST /api/v1/graph/*`) and MCP (`graph_path`, `graph_relate`, `graph_similar`, `graph_unused`, `cycles`, `deps`, `co_change`, `blast_radius` tools; `callers`/`callees` gained HTTP routes and reuse the existing `call_graph` MCP tool), matching the CLI's existing flag surface. `graph build` remains CLI-only — it's a mutating, truncate-and-rebuild index-maintenance operation, not a query, consistent with `index vacuum`/`gc`/`rebuild-fts`/etc.
- e21c719: `POST /api/v1/guide/chat` (HTTP API) now accepts a `lens: 'semantic'|'structural'|'hybrid'` field, mirroring CLI `gitsema guide --lens` — under `structural`/`hybrid` it biases the guide agent's tool choice toward `call_graph`/`blast_radius`/`hotspots`, identically to the CLI. Remote multi-turn/session support (an HTTP equivalent of CLI `guide --interactive`) remains a deferred, unresolved design question — see `docs/feature-ideas.md`.
- d2aa439: Add identity & credentials core for `gitsema tools serve`: user accounts with password login (`gitsema auth login/logout/whoami`) and long-lived API keys (`gitsema auth token create/list/revoke`), backed by new `users`/`sessions`/`api_keys` tables. The server's auth middleware now resolves these alongside the existing `GITSEMA_SERVE_KEY`/per-repo token mechanisms.
- fff805d: LSP `textDocument/hover` now enriches its semantic matches with optional Temporal (last touch/change frequency), Risk & quality (debt/hotspot/security), and Structure (caller/callee counts) sections when their data is available. Added `textDocument/codeLens` with per-symbol "Called N× · debt X.XX" annotations, and an opt-in `gitsema tools lsp --diagnostics` flag that pushes `textDocument/publishDiagnostics` notifications for high-debt/high-hotspot-risk files on a background timer (not supported together with `--remote`).
- fff805d: Added remote delegation for the MCP and LSP servers: `gitsema tools mcp --remote <url>` and `gitsema tools lsp --remote <url>` (with `--remote-key`/`--remote-timeout`, or `GITSEMA_REMOTE`/`GITSEMA_REMOTE_KEY`) now proxy every data-access call to a running `gitsema tools serve` instance via a new generic `POST /api/v1/protocol/:operation` route, with a startup health check that fails fast if the remote is unreachable.
- fff805d: Added a WebSocket transport for both protocol servers: `gitsema tools mcp --websocket <bind-address>` and `gitsema tools lsp --websocket <bind-address>` (e.g. `--websocket 0.0.0.0:4242`) listen on fixed `/mcp`/`/lsp` paths, with `--key <token>` requiring a matching `Authorization: Bearer <token>` header. Unlike `--remote` delegation, WebSocket supports server push, so `--diagnostics` now works together with `--websocket`. gitsema does not terminate TLS — put a reverse proxy in front for `wss://`.
- fff805d: LSP `textDocument/definition` and `textDocument/references` now resolve structurally first when the knowledge graph (`gitsema graph build`) is built, returning exact matches instead of approximate semantic/text results (fallback results are now tagged `tags: ['fallback']`). Added three new LSP methods backed by the same graph: `textDocument/prepareCallHierarchy`, `callHierarchy/incomingCalls`, and `callHierarchy/outgoingCalls`, advertised via a new `callHierarchyProvider: true` capability.
- fff805d: Added `gitsema tools mcp --http <bind-address>` (e.g. `--http 0.0.0.0:4242`) — a proper MCP Streamable HTTP transport using the SDK's own `StreamableHTTPServerTransport`, listening on a fixed `/mcp` path with stateful sessions tracked via the `Mcp-Session-Id` header. `--key <token>` requires a matching `Authorization: Bearer <token>` header, same convention as `--websocket`. Unlike the non-standard `--websocket` transport (kept only for forward compatibility), Streamable HTTP is MCP's actual recommended network transport and should be preferred by clients/harnesses that need a network-reachable MCP server.
- 8bb2b62: Add multi-profile embedding serving: a `gitsema tools serve` deployment can now offer several named embedding profiles (provider/model pairs) at once via `GITSEMA_EMBEDDING_PROFILES`/the `embeddingProfiles` config key. Repos are pinned to a profile forever at first index (`gitsema remote-index --profile <name>`), and `gitsema repos info <repo-id>` shows the pinned profile. Servers with no profiles configured behave exactly as before.
- a6ce2aa: `POST /narrate` and `POST /explain` now accept an `evidenceOnly` field, letting HTTP callers explicitly request the same safe-by-default evidence-only mode as the CLI's `narrate`/`explain` (omitted = evidence-only, no LLM call) — both responses also gain a structured `evidence` array. `POST /explain` additionally accepts `log` (error/stack-trace context file) and `files` (search-scope glob), and both routes accept `lens`, which on `/explain` returns a `structuralContext` field (call-graph/co-change enrichment) when combined with a concrete `files` path under a `structural`/`hybrid` lens.
- 8ff9b51: Adds orgs, personal groups, and repo/branch grants (Phase 123 of the multi-tenant auth track): every user now belongs to one or more orgs (an auto-provisioned personal org, or an explicit team org with `org_admin`/`member` roles), and repo access is granted per-user via `repo_grants` (`read`/`write`/`owner`, optionally scoped to a branch glob). New CLI: `gitsema orgs create/list/members add/remove/list`, `gitsema users create/list`, and `gitsema repos grant/grants/revoke/move-to-org`. New HTTP routes under `/api/v1/orgs` and `/api/v1/repos/:repoId/{grants,move-to-org}`.
- 1e89cea: `bisect`, `refactor-candidates`, `lifecycle`, `cherry-pick-suggest`, `file-diff`, `pr-report`, `regression-gate`, `code-review`, `map`, and `heatmap` are now available as MCP tools and `POST /api/v1/insights/*` HTTP routes, not just CLI commands — AI clients and remote callers can now reach them directly. Also fixes a pre-existing bug in `refactor-candidates`' default symbol-level scan that made it error out on any index with symbol embeddings.
- c0b059a: Add public repo sharing: persisted repos can now be flagged `public` (`gitsema repos visibility <repo-id> public|private`), auto-granting `read` access to non-owner callers who index an existing public repo, gated by a first-index allow-list (`auth.allowPublicAutoIndex`/`GITSEMA_PUBLIC_AUTO_INDEX`) and a per-user re-index throttle (`auth.minReindexIntervalSeconds`/`GITSEMA_MIN_REINDEX_INTERVAL_SECONDS`).
- 56170f3: Removed the `tools lsp --tcp` transport entirely (previously deprecated in Phase 120 in favor of `--websocket --key`): raw TCP had no authentication mechanism at all, and nothing in the test suite exercised it. `gitsema tools lsp`/`gitsema lsp` are now stdio or `--websocket` only — use `--websocket <bind-address> --key <token>` for network-reachable LSP access.
- 8c471ee: MCP `semantic_search`/`first_seen` and HTTP `POST /search`/`POST /search/first-seen` now have full flag parity with CLI `search`/`first-seen`: per-level result separation (a new `module` search level, plus labeled per-level output or a `resultsByLevel` JSON shape when 2+ of chunk/symbol/module are active, with `merge_levels`/`mergeLevels` to opt back into one merged list), negative-example scoring (`not_like`/`notLike`, `lambda`), boolean query composition (`or`/`and`), `explain`, LLM provenance citations (`explain_llm`/`explainLlm`), query expansion (`expand_query`/`expandQuery`), cluster annotation (`annotate_clusters`/`annotateClusters`), HNSW ANN search (`vss`), multi-repo search (`repos`), per-request embedding model overrides (`model`/`text_model`/`code_model` on MCP, `model`/`textModel`/`codeModel` on HTTP), candidate-pool sampling (`early_cut`/`earlyCut`), and cache bypass (`no_cache`/`noCache`). This is a breaking change to the HTTP `POST /search` JSON response shape when 2+ search levels are active (now `{ resultsByLevel: {...} }` instead of a flat array), matching CLI's existing per-level behavior. `POST /api/v1/analysis/multi-repo-search` is now deprecated in favor of `POST /api/v1/search` with a `repos` param — the old route still works unchanged, with a `Deprecation` response header pointing at its replacement.
- 536fffd: Adds SSO/OIDC identity linking (Phase 124 of the multi-tenant auth track): a user can have an external `(provider, externalId)` identity linked alongside their password/API keys, all resolving to the same account. Providers must be explicitly allowlisted via `GITSEMA_SSO_PROVIDERS`. New operator CLI: `gitsema auth sso link/unlink/list`. New self-service HTTP routes: `GET /api/v1/auth/sso` and `DELETE /api/v1/auth/sso/:provider/:externalId`. The live browser-based OIDC login flow is not yet implemented — linking an identity is currently an operator action.
- c3cf147: Add a unified subgraph view (Phase 112) to `graph neighbors`, `graph path`, `blast-radius`, `relate`, `similar`, and `hotspots`: pass `--out html:graph.html` for an interactive force-directed graph (clicking a node shows its details and suggested follow-up commands), or `--out text`/`--out markdown:graph.md` for an ASCII tree / nested bullet list rendering, alongside each command's existing JSON and default text output.
- 5776e67: The HTTP API now exposes `GET /watch` (list saved watch queries) and `DELETE /watch/:name` (remove one by name), matching the CLI's `watch list`/`watch remove` — previously only `watch add`/`watch run` had HTTP routes.
- efe53ab: The HTTP `POST /analysis/workflow` route now supports all 8 productized workflow templates that CLI `workflow run` has (`pr-review`, `incident`, `release-audit`, `onboarding`, `ownership-intel`, `arch-drift`, `knowledge-portal`, `regression-forecast`) instead of just 3, and accepts `role`/`ref` body fields (mirroring CLI `--role`/`--ref`) generally rather than gated to a single template.

### Patch Changes

- 6ce5b85: Fix a gap in the audit log: attaching as a reader to an existing public repo (the "attach-as-reader" auto-grant on `POST /api/v1/remote/index`) now records a `grant.create` audit event, matching every other `repo_grants` write path.
- 01ce44d: Extracted the duplicated `4000`-char LLM-result truncation cap (previously a separate constant in `guideTools.ts` and `llm/narrator.ts`) into a single shared `core/narrator/resultCap.ts` helper. Also refreshed `docs/feature-ideas.md` — removed LSP/MCP remote-delegation, WebSocket, structural-navigation, and diagnostics/hover ideas that shipped as Phases 113–117, and added the still-undesigned plugin-API idea.
- 37edcbf: Deprecate `gitsema index backfill-fts` (and its existing top-level alias `gitsema backfill-fts`) in favor of `gitsema index rebuild-fts`. No index database predating Phase 11 remains in active use, so the Git-refetch behavior `backfill-fts` provided is no longer needed; both commands print a deprecation warning but keep working.
- 4d87c08: `gitsema tools lsp --tcp` is now deprecated in favor of `--websocket --key`: raw TCP has no request framing to carry a Bearer token in, so the unauthenticated-`--tcp` gap flagged in review10 is closed by steering users to the already-authenticated WebSocket transport instead of inventing a bespoke handshake-auth protocol. `--tcp` continues to work unchanged but now prints a deprecation notice on every invocation.
- cd9f1b6: Ephemeral (non-persisted) remote-index jobs now resolve embedding providers through the same profile-pinning/enforcement path as persisted jobs.
- fff805d: Fixed two gaps in `gitsema tools mcp --remote`: the `narrate_repo` and `explain_issue_or_error` tools now delegate to the remote server like every other tool (they previously always ran locally), and `--remote` now also takes effect when combined with `--websocket` or `--http` (previously only the default stdio transport honored it).
- fff805d: `gitsema tools mcp --websocket` now prints a startup warning that raw WebSocket is not one of MCP's standard transports and is unlikely to work with most MCP clients/harnesses — it's kept for forward compatibility, not removed. A proper MCP Streamable HTTP transport is planned as a follow-up (see `docs/PLAN.md` Phase 117).
- 6c9e06c: `gitsema models add <name> --level <level>` now actually takes effect: `index start` and `search` fall back to a model's saved `--level` when no explicit `--chunker`/`--level`/`--profile` flag is passed, instead of silently ignoring it (Phase 77 Goal #4 closed).
- bbfa34c: Postgres storage backend now probes the connection (`SELECT 1`) on first use, so a bad or unreachable `storage.metadata.url`/`GITSEMA_STORAGE_METADATA_URL` fails with an actionable error instead of an opaque driver error at the first query — mirroring the existing Qdrant connection probe. Also fixed a stale "in progress" roadmap heading and the recurring `docs/features.md` version-banner drift, now enforced by a test.
- e28d643: Closes out review10's remaining findings: the MCP WebSocket/Streamable HTTP listeners and the LSP TCP/WebSocket listeners now cap payload size and concurrent connections/sessions, and warn at startup when bound to a non-loopback address without a `--key` (with `GITSEMA_WEBSOCKET_KEY`/`GITSEMA_MCP_HTTP_KEY` env-var fallbacks for `--key`); `tools lsp --tcp` is documented as unauthenticated. `hotspots`' `topK` parameter is now capped at 500 on the HTTP route and MCP tool. `regression-gate`/`code-review`'s git ref handling moved from shell-interpolated `execSync` to `execFileSync` with the same git-ref allowlist used elsewhere. `resolveNode()` now uses an indexed `display_name` lookup instead of a full graph scan, the HTML viz's client-side `esc()` helper now escapes quotes to match the server-side escaper, and `gitsema cycles`' DFS no longer risks a stack overflow on very long import chains.

## 0.96.0

### Minor Changes

- b91836b: Knowledge-graph Phases 110–111: fusion + lens coverage.

  - **`gitsema hotspots`** — rank files by architectural risk = co-change (temporal) × call-coupling (structural) × churn. Available as a CLI command, MCP tool, and `POST /api/v1/graph/hotspots` HTTP route, with a `--lens semantic|structural|hybrid` toggle (default hybrid) that selects which signals drive the score.
  - **Cascade query planner** — a four-stage `FTS filter → vector expand → graph traversal → merge/rerank` pipeline powers the hybrid lens for query-driven fusion, surfacing structurally-adjacent code that pure semantic search misses while leaving semantic-lens output byte-for-byte unchanged.
  - **Structural enrichment** — `code-review`, `triage`, `explain`, and `guide` gain `--lens`: under a structural/hybrid lens they surface grounded call-graph and co-change context (e.g. "called by N callers", "co-changes with file X 80% of the time"). The `guide` agent also gains `call_graph`, `blast_radius`, and `hotspots` tools.
  - **Lens coverage sweep** — every command where more than one lens is meaningful now exposes the shared `--lens` option with consistent defaults (existing commands → semantic, graph-native → structural, fusion → hybrid) and per-hit lens labels across text/JSON output.

- b91836b: Make the agent skill self-serve for tools, and expose it over MCP.

  - The generated skill (`skill/gitsema-ai-assistant.md`) now documents **both** how to use each tool (description + parameters) and how to read its result, joined per tool — previously it carried only result interpretation.
  - New **`get_skill`** MCP tool returns the skill document, so MCP clients can fetch gitsema's operating playbook (usage + interpretation for every tool) at the start of a session instead of having it only embedded in the guide's own prompt.

- ce84122: Add `gitsema index start --graph` to extract raw structural references (imports, calls, `extends`/`implements`) from TS/TSX/JS/Python blobs into a new `structural_refs` table (schema v25), laying the groundwork for the upcoming knowledge-graph traversal commands.
- 5efa2e4: Add `gitsema graph build`, which resolves `structural_refs`/`symbols`/`blob_commits` into a structural knowledge graph (`graph_nodes` + typed `edges`: contains, defines, imports, calls, extends, implements, references, co_change) using confidence-tier resolution for ambiguous references. New CLI commands `gitsema co-change <path>`, `gitsema deps <identifier>`, and `gitsema graph cycles` / `gitsema cycles` read from the resulting graph (schema v26).
- 7c540bd: Add graph traversal primitives over the Phase 107 structural graph: `gitsema graph callers <symbol>` / `gitsema graph callees <symbol>` (transitive `calls` traversal, default and max depth 3), `gitsema graph neighbors <node>` (typed neighborhood, any edge kinds, configurable direction/depth), and `gitsema graph path <a> <b>` (shortest typed path between two nodes). New MCP tools `call_graph` and `graph_neighbors` expose the same traversals.
- 7c540bd: Add a cross-cutting `--lens semantic|structural|hybrid` toggle (plus `--weight-structural <n>`) and four new structural/semantic fusion commands: `gitsema blast-radius <symbol>` ("what changes if I touch this" — structural dependents and/or semantically similar blobs), `gitsema relate <symbol>` (callers/callees plus semantically similar blobs, both lenses), `gitsema similar <symbol>` (same call/import shape and/or semantic similarity), and `gitsema unused` (symbols/files with no inbound calls/imports edges). `gitsema impact <path> --lens structural|hybrid` now reuses `blast-radius` for true structural impact analysis.
- 5037791: Symbols now carry stable, path-free identities: `code-search` and the LSP `documentSymbol` results show fully-qualified names with normalized signatures (e.g. `Auth.validateToken(token:string)`) for TypeScript, TSX, JavaScript, and Python. The `symbols` table gains nullable `qualified_name`, `signature`, `signature_hash`, and `parent_qualified_name` columns (schema v24); older rows remain unaffected until re-indexed.

### Patch Changes

- 6c3b0cc: Add comprehensive tool parity and flag coherence documentation in `docs/parity.md`. This canonical reference tracks tool availability across all interfaces (CLI, REPL, Guide, MCP, HTTP, and planned CLI Interactive/Web UI/MCP HTTP) and documents flag implementation consistency. Includes maintenance guidelines to keep tables in sync with code changes. Updated CLAUDE.md to include parity.md in canonical documentation and added requirement to update parity tables when tools/interfaces/flags change.

## 0.95.0

### Minor Changes

- 7b52757: Added a generic `--narrate` flag (LLM summary via the active narrator model, requires `GITSEMA_LLM_URL`) to `first-seen`, `branch-summary`, `merge-audit`, `merge-preview`, `dead-concepts`, `debt`, `doc-gap`, `security-scan`, `blame`/`semantic-blame`, `triage`, `impact`, `ownership`, `experts`, `author`, `contributor-profile`, `bisect`, `refactor-candidates`, `cherry-pick-suggest`, and `heatmap`. Also expanded `gitsema guide`'s tool coverage to `bisect`, `refactor-candidates`, `cherry-pick-suggest`, `heatmap`, `map`, `file-diff`, `lifecycle`, `cluster-change-points`, `cross-repo-similarity`, and `pr-report`, and added `gitsema setup` as a guided onboarding wizard (alias of `gitsema quickstart`) with a storage-backend selection step (sqlite/postgres/qdrant) and an optional narrator/guide model setup step.

### Patch Changes

- a765b31: Make non-SQLite storage backends fail loudly instead of silently returning
  wrong results. The Postgres and Qdrant vector backends now reject search
  options they cannot honor (`allowedHashes` candidate filtering used by
  boolean/negative-example search; negative-example search on Qdrant) with a
  clear error, `gitsema index --file` errors on non-sqlite backends instead of
  writing to an index the backend never reads, and indexing warns when
  module-level (directory-centroid) embeddings are skipped on a non-sqlite
  backend.
- 17b5d13: Fix `multi_repo_search` returning the wrong repository's results and leaking
  database connections. Each repo's index is now made the active session for its
  search (so results come from that repo, not the caller's working directory),
  the connection is closed afterwards, and the process-global search result cache
  key now includes the active database path so searches against different indexes
  in one process no longer collide.
- f75c278: Fix a command-injection vulnerability in `gitsema narrate`/`explain` (and the
  `POST /api/v1/narrate` and `/explain` HTTP routes): the `--range`/`since`/`until`
  inputs were interpolated into a shell `git log` invocation. The narrator now
  spawns git without a shell and validates `--range` against a revision allowlist,
  closing both the CLI and HTTP injection vectors.
- edbe0d3: Ensure secret/PII redaction is always applied before any narrator prompt is
  sent to an LLM. Previously the per-result `--narrate` helpers (search,
  evolution, clusters, diff, security findings, etc.) sent prompts unredacted;
  redaction now happens at the shared call site so every narration path is
  covered.
- 7b52757: Fixed test isolation so the test suite no longer creates a stray `.gitsema/index.db` in the repo root, which could intermittently cause unrelated guide-tool tests to fail.
- 9f00e17: Internal hardening and de-duplication: Postgres and Qdrant vector backends now
  share one re-ranking implementation; the narrator providers share their
  redaction/disabled-mode prologue; Postgres and Qdrant connections are probed
  once on first use so a bad URL fails with a clear, config-pointing error
  instead of an opaque connection error at first query.

## 0.94.0

### Minor Changes

- bf88b00: Add CLI-based AI tool backends (e.g. Claude Code, Codex CLI, GitHub Copilot CLI) as narrator/guide model providers, alongside the existing HTTP-based ones. Configure with `gitsema models add <name> --narrator|--guide --provider cli --cli-command <tool> [--cli-args "<args>"] [--use-mcp] --activate`; `guide --use-mcp` exposes gitsema's own MCP server to the CLI tool's agent loop, and multi-turn `-i/--interactive` sessions are kept coherent via the tool's session-resume mechanism.
- 26c56df: `gitsema guide` now wires the full ~36-capability gitsema toolset (history, branch/merge, ownership, quality, diff/blame, clustering, and workflow analyses, not just the original 5) into its agentic tool-calling loop, with a dynamic system prompt built from a new per-tool interpretation registry. The same registry also drives the `narrate`/`explain` narrators and a generated "Interpreting gitsema tool results" section in the gitsema-ai-assistant skill (`pnpm gen:skill`), which now ships with the npm package. Documented Ollama setup for `narrate`/`explain`/`guide`.
- 4dd1f73: Add `--provider ollama` to `gitsema models add <name> --narrator|--guide`, which defaults `--http-url` to `http://localhost:11434` and sends the correct `model` field to Ollama's chat API (fixing a bug where the narrator/guide HTTP path sent a hardcoded `model: "default"`, which Ollama rejects). `gitsema models add [name]` now also accepts an optional model name for embedding, narrator, and guide configs: when omitted with `--provider ollama`, gitsema lists the models available on your local Ollama server.
- 18397fa: `gitsema tools serve` now persists cloned repos and their indexes under `GITSEMA_DATA_DIR` (default `~/.gitsema/data`) by default, reusing them on subsequent `/api/v1/remote/index` requests (fetch + incremental reindex instead of a fresh clone). The response includes a `repoId` that can be passed to search, evolution, analysis, watch, projections, narrate, explain, and guide routes to query that repo's persisted index. SSH agent forwarding lets the server re-index private repos without per-request credentials. Use `persist: false` for the legacy ephemeral behavior, and manage persisted repos with `gitsema repos list-persisted` and `gitsema repos remove <repoId> [--purge]`.
- 954d67c: Add a Postgres + pgvector storage backend (`storage.backend=postgres`, `storage.metadata.url=postgres://...`) as an alternative to SQLite for search, history, evolution, and other read-path commands. Keyword search defaults to `tsvector`/`ts_rank_cd`, with ParadeDB `pg_search` BM25 available as an opt-in (`storage.fts.backend=pg_search`). `gitsema index` does not yet write to this backend — that's planned for a follow-up phase.
- 30f9da4: Add a Qdrant storage backend (`storage.backend=qdrant`, `storage.vectors.url=http://...` + a Postgres companion via `storage.metadata.url`), and make `gitsema index` write to the Postgres and Qdrant backends (previously read-only). Add `gitsema storage migrate --to <backend> [options]` to copy an existing index into another backend (sqlite/postgres/qdrant), and extend `gitsema doctor`/`gitsema status` to report backend/scope/location and cross-store row counts for postgres/qdrant profiles.
- a186de7: Introduce a pluggable storage seam (Phase 101): the `MetadataStore`,
  `VectorStore`, and `FtsStore` async interfaces with a SQLite-backed adapter that
  preserves today's behavior, plus `storage.*` config keys and a
  `project | user | named` index-scoping model. No new backend yet — this is the
  groundwork for the Postgres + pgvector and Qdrant backends.

### Patch Changes

- 30f9da4: Refresh docs/PLAN.md table of contents to cover Phases 99-104 and fix drifted line-number references.

## 0.93.0

### Minor Changes

- 72076ef: New LLM narrator, explainer, and agentic guide (schema v22). `gitsema narrate` and `gitsema explain <topic>` return raw commit evidence by default (no network calls) and generate LLM prose with `--narrate` once a narrator model is configured via `gitsema models add <name> --narrator --http-url <url> --activate`. `gitsema guide [question]` answers questions about your repository with a real tool-calling agent loop (repo stats, recent commits, narrate/explain evidence, semantic search), supports multi-turn `--interactive` mode, and redacts secrets from every payload sent to the LLM. Also exposed as MCP tools (`narrate_repo`, `explain_issue_or_error`) and HTTP routes (`/api/v1/narrate`, `/explain`, `/guide/chat`).
- 37872be: Adopt changesets for versioning, changelog generation, and npm publishing. Releases are now driven by the changesets "Version Packages" PR on `main` (published to npm via OIDC trusted publishing) instead of manually pushed `v*` tags. Contributors add a changeset file (`pnpm exec changeset`) with each user-facing change; CHANGELOG.md is generated from these entries.

Entries below are generated by [changesets](https://github.com/changesets/changesets) starting from v0.93.0. For earlier release history (v0.2.0 – v0.92.1, tagged manually), see the [GitHub Releases](https://github.com/jsilvanus/gitsema/releases) and the phase log in [`docs/PLAN.md`](docs/PLAN.md).

## Pre-changesets history (≤ 0.92.1)

- Time filter semantics (use last-seen timestamps), accept commit-ish refs in `--after`/`--before`, and stabilized `search_after` pagination (PRs #67, #68).
