# gitsema

## 0.97.0

### Minor Changes

- e7fefea: Add superadmin-controlled model allow-lists and bring-your-own-key (BYOK) support. Operators can now restrict which embedding profiles or narrator/guide model configs are usable, server-wide or per-org, via `gitsema admin models list|allow|deny|reset --kind <embedding|narrator|guide> [--org <name>]`. Independently, `narrate`/`explain`/`guide` (CLI, HTTP, and MCP) accept request-scoped BYOK credentials (`--byok-http-url`/`--byok-api-key`/`--byok-model`/`--byok-max-tokens`/`--byok-temperature` and equivalent HTTP/MCP fields) that bypass the allow-list entirely and are never persisted.
- 418779b: Add an identity/authorization audit log: sensitive actions (grant create/revoke, token create/revoke, login success/failure, org membership changes, repo org moves) recorded on the HTTP auth/orgs routes and queryable via `gitsema audit log [--org] [--repo] [--limit]`. Completes the Multi-Tenant Auth Track (Phases 122-125).
- 83b3de6: Add `gitsema index doctor --fix`: automatically backfills missing FTS5 content and garbage-collects orphan embeddings when those issues are detected, then re-reports index health — no need to run `index backfill-fts`/`index gc` separately.
- d2aa439: Add identity & credentials core for `gitsema tools serve`: user accounts with password login (`gitsema auth login/logout/whoami`) and long-lived API keys (`gitsema auth token create/list/revoke`), backed by new `users`/`sessions`/`api_keys` tables. The server's auth middleware now resolves these alongside the existing `GITSEMA_SERVE_KEY`/per-repo token mechanisms.
- fff805d: LSP `textDocument/hover` now enriches its semantic matches with optional Temporal (last touch/change frequency), Risk & quality (debt/hotspot/security), and Structure (caller/callee counts) sections when their data is available. Added `textDocument/codeLens` with per-symbol "Called N× · debt X.XX" annotations, and an opt-in `gitsema tools lsp --diagnostics` flag that pushes `textDocument/publishDiagnostics` notifications for high-debt/high-hotspot-risk files on a background timer (not supported together with `--remote`).
- fff805d: Added remote delegation for the MCP and LSP servers: `gitsema tools mcp --remote <url>` and `gitsema tools lsp --remote <url>` (with `--remote-key`/`--remote-timeout`, or `GITSEMA_REMOTE`/`GITSEMA_REMOTE_KEY`) now proxy every data-access call to a running `gitsema tools serve` instance via a new generic `POST /api/v1/protocol/:operation` route, with a startup health check that fails fast if the remote is unreachable.
- fff805d: Added a WebSocket transport for both protocol servers: `gitsema tools mcp --websocket <bind-address>` and `gitsema tools lsp --websocket <bind-address>` (e.g. `--websocket 0.0.0.0:4242`) listen on fixed `/mcp`/`/lsp` paths, with `--key <token>` requiring a matching `Authorization: Bearer <token>` header. Unlike `--remote` delegation, WebSocket supports server push, so `--diagnostics` now works together with `--websocket`. gitsema does not terminate TLS — put a reverse proxy in front for `wss://`.
- fff805d: LSP `textDocument/definition` and `textDocument/references` now resolve structurally first when the knowledge graph (`gitsema graph build`) is built, returning exact matches instead of approximate semantic/text results (fallback results are now tagged `tags: ['fallback']`). Added three new LSP methods backed by the same graph: `textDocument/prepareCallHierarchy`, `callHierarchy/incomingCalls`, and `callHierarchy/outgoingCalls`, advertised via a new `callHierarchyProvider: true` capability.
- fff805d: Added `gitsema tools mcp --http <bind-address>` (e.g. `--http 0.0.0.0:4242`) — a proper MCP Streamable HTTP transport using the SDK's own `StreamableHTTPServerTransport`, listening on a fixed `/mcp` path with stateful sessions tracked via the `Mcp-Session-Id` header. `--key <token>` requires a matching `Authorization: Bearer <token>` header, same convention as `--websocket`. Unlike the non-standard `--websocket` transport (kept only for forward compatibility), Streamable HTTP is MCP's actual recommended network transport and should be preferred by clients/harnesses that need a network-reachable MCP server.
- 8bb2b62: Add multi-profile embedding serving: a `gitsema tools serve` deployment can now offer several named embedding profiles (provider/model pairs) at once via `GITSEMA_EMBEDDING_PROFILES`/the `embeddingProfiles` config key. Repos are pinned to a profile forever at first index (`gitsema remote-index --profile <name>`), and `gitsema repos info <repo-id>` shows the pinned profile. Servers with no profiles configured behave exactly as before.
- 8ff9b51: Adds orgs, personal groups, and repo/branch grants (Phase 123 of the multi-tenant auth track): every user now belongs to one or more orgs (an auto-provisioned personal org, or an explicit team org with `org_admin`/`member` roles), and repo access is granted per-user via `repo_grants` (`read`/`write`/`owner`, optionally scoped to a branch glob). New CLI: `gitsema orgs create/list/members add/remove/list`, `gitsema users create/list`, and `gitsema repos grant/grants/revoke/move-to-org`. New HTTP routes under `/api/v1/orgs` and `/api/v1/repos/:repoId/{grants,move-to-org}`.
- c0b059a: Add public repo sharing: persisted repos can now be flagged `public` (`gitsema repos visibility <repo-id> public|private`), auto-granting `read` access to non-owner callers who index an existing public repo, gated by a first-index allow-list (`auth.allowPublicAutoIndex`/`GITSEMA_PUBLIC_AUTO_INDEX`) and a per-user re-index throttle (`auth.minReindexIntervalSeconds`/`GITSEMA_MIN_REINDEX_INTERVAL_SECONDS`).
- 536fffd: Adds SSO/OIDC identity linking (Phase 124 of the multi-tenant auth track): a user can have an external `(provider, externalId)` identity linked alongside their password/API keys, all resolving to the same account. Providers must be explicitly allowlisted via `GITSEMA_SSO_PROVIDERS`. New operator CLI: `gitsema auth sso link/unlink/list`. New self-service HTTP routes: `GET /api/v1/auth/sso` and `DELETE /api/v1/auth/sso/:provider/:externalId`. The live browser-based OIDC login flow is not yet implemented — linking an identity is currently an operator action.
- c3cf147: Add a unified subgraph view (Phase 112) to `graph neighbors`, `graph path`, `blast-radius`, `relate`, `similar`, and `hotspots`: pass `--out html:graph.html` for an interactive force-directed graph (clicking a node shows its details and suggested follow-up commands), or `--out text`/`--out markdown:graph.md` for an ASCII tree / nested bullet list rendering, alongside each command's existing JSON and default text output.

### Patch Changes

- 01ce44d: Extracted the duplicated `4000`-char LLM-result truncation cap (previously a separate constant in `guideTools.ts` and `llm/narrator.ts`) into a single shared `core/narrator/resultCap.ts` helper. Also refreshed `docs/feature-ideas.md` — removed LSP/MCP remote-delegation, WebSocket, structural-navigation, and diagnostics/hover ideas that shipped as Phases 113–117, and added the still-undesigned plugin-API idea.
- 37edcbf: Deprecate `gitsema index backfill-fts` (and its existing top-level alias `gitsema backfill-fts`) in favor of `gitsema index rebuild-fts`. No index database predating Phase 11 remains in active use, so the Git-refetch behavior `backfill-fts` provided is no longer needed; both commands print a deprecation warning but keep working.
- 4d87c08: `gitsema tools lsp --tcp` is now deprecated in favor of `--websocket --key`: raw TCP has no request framing to carry a Bearer token in, so the unauthenticated-`--tcp` gap flagged in review10 is closed by steering users to the already-authenticated WebSocket transport instead of inventing a bespoke handshake-auth protocol. `--tcp` continues to work unchanged but now prints a deprecation notice on every invocation.
- fff805d: Fixed two gaps in `gitsema tools mcp --remote`: the `narrate_repo` and `explain_issue_or_error` tools now delegate to the remote server like every other tool (they previously always ran locally), and `--remote` now also takes effect when combined with `--websocket` or `--http` (previously only the default stdio transport honored it).
- fff805d: `gitsema tools mcp --websocket` now prints a startup warning that raw WebSocket is not one of MCP's standard transports and is unlikely to work with most MCP clients/harnesses — it's kept for forward compatibility, not removed. A proper MCP Streamable HTTP transport is planned as a follow-up (see `docs/PLAN.md` Phase 117).
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
