# gitsema

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
