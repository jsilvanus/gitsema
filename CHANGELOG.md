# gitsema

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
