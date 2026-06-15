# gitsema

![Gitsema logo](assets/logo.png)

[![npm version](https://img.shields.io/npm/v/gitsema.svg)](https://www.npmjs.com/package/gitsema) [![CI](https://github.com/jsilvanus/gitsema/actions/workflows/ci.yml/badge.svg)](https://github.com/jsilvanus/gitsema/actions/workflows/ci.yml)

A content-addressed semantic index synchronized with Git's object model.

Gitsema walks your Git history, embeds every blob, and lets you semantically search your codebase — including across time. It treats blob hashes as the unit of identity, so identical content is only embedded once regardless of how many commits reference it.

For a comprehensive feature catalog see [`docs/features.md`](docs/features.md). For the development roadmap see [`docs/PLAN.md`](docs/PLAN.md).

---

## Installation & quick start

**Requirements:** Node.js 18+, Git on `PATH`, and an embedding backend (Ollama or any OpenAI-compatible HTTP API).

```bash
pnpm install       # install dependencies
pnpm build         # compile TypeScript → dist/
pnpm link --global # optional: put `gitsema` on PATH
```

**Development (no build step):**
```bash
pnpm dev -- <command> [options]
# e.g.: pnpm dev -- search "authentication middleware"
```

**Running compiled output:**
```bash
node dist/cli/index.js <command> [options]
```

### Ollama quick start

```bash
ollama pull nomic-embed-text
gitsema index start
gitsema search "authentication middleware"
```

Or run the guided wizard, which detects your provider, configures a model and storage backend (sqlite/postgres/qdrant), optionally configures a narrator/guide model, and indexes HEAD in one step:

```bash
gitsema setup
# (gitsema quickstart is a backward-compat alias)
```

### OpenAI-compatible HTTP example

```bash
export GITSEMA_PROVIDER=http
export GITSEMA_HTTP_URL=https://api.openai.com
export GITSEMA_MODEL=text-embedding-3-small
export GITSEMA_API_KEY=sk-...
gitsema index start
```

**Multi-model routing:** set `GITSEMA_CODE_MODEL` to a different model than `GITSEMA_TEXT_MODEL` to use separate models for code and prose. When they match (the default), a single provider is used.

---

## Configuration

Configuration is read from environment variables or persisted via `gitsema config` (stored in `.gitsema/config.json`, repo-level by default, or `~/.config/gitsema/config.json` with `--global`). Environment variables always override config-file values.

| Variable | Default | Description |
|---|---|---|
| `GITSEMA_PROVIDER` | `ollama` | `ollama` or `http` |
| `GITSEMA_MODEL` | `nomic-embed-text` | Default embedding model |
| `GITSEMA_TEXT_MODEL` | `$GITSEMA_MODEL` | Model for prose/docs |
| `GITSEMA_CODE_MODEL` | `$GITSEMA_TEXT_MODEL` | Model for source code files |
| `GITSEMA_HTTP_URL` | *(required if `http`)* | Base URL of OpenAI-compatible API |
| `GITSEMA_API_KEY` | *(optional)* | Bearer token for the HTTP provider |
| `GITSEMA_VERBOSE` | off | Set to `1` for debug logging (or pass `--verbose`) |
| `GITSEMA_LOG_MAX_BYTES` | `1048576` | Log rotation threshold (1 MB) |
| `GITSEMA_SERVE_PORT` | `4242` | Port for `gitsema tools serve` |
| `GITSEMA_SERVE_KEY` | *(optional)* | Bearer token required by `gitsema tools serve` |
| `GITSEMA_LLM_URL` | *(optional)* | OpenAI-compatible URL for `--narrate` LLM summaries |
| `GITSEMA_DATA_DIR` | `~/.gitsema/data` | Root directory where `gitsema tools serve` persists cloned repos + index DBs (`repos/<repoId>/{repo,index.db}`, `registry.db`) |

Run `gitsema config list` to see every active key and where its value came from (env, repo config, global config, or default). Supported dot-notation keys include `provider`, `model`, `textModel`, `codeModel`, `httpUrl`, `apiKey`, `llmUrl`, `llmModel`, `remoteUrl`, `remoteKey`, `index.concurrency`, `index.maxCommits`, `index.ext`, `index.maxSize`, `index.exclude`, `index.chunker`, `index.windowSize`, `index.overlap`, `search.top`, `search.hybrid`, `search.recent`, `search.weightVector`, `search.weightRecency`, `search.weightPath`, `evolution.threshold`, `clusters.k`, `hooks.enabled`, `vscode.mcp`, `vscode.lsp`, `storage.backend`, `storage.scope`, `storage.name`, `storage.metadata.url`, `storage.vectors.url`, `storage.vectors.apiKey`, `storage.fts.backend`, and more.

> **Storage backends (experimental, Phases 101–103):** `storage.backend` selects where the index lives — `sqlite` (the default), `postgres` (+ pgvector), and `qdrant` are all implemented. For postgres, set `storage.metadata.url=postgres://user:pass@host:5432/dbname` (see `docker-compose.postgres.yml` for a local pgvector instance) and optionally `storage.fts.backend=tsvector|pg_search|none`. For qdrant, set `storage.vectors.url=http://host:6333` (see `docker-compose.qdrant.yml`) plus `storage.metadata.url=postgres://...` (a Postgres companion for paths/commits/branches/FTS) and optionally `storage.vectors.apiKey`. `gitsema index` and all read-path commands (search, history, evolution, etc.) work against postgres and qdrant. `storage.scope` chooses which index a command resolves to: `project` (per-repo `.gitsema/`, default), `user` (`~/.gitsema/`), or `named` (an explicitly addressed index via `storage.name`). Use `gitsema storage migrate --to <backend> [...]` to copy an existing sqlite index into postgres/qdrant/sqlite, and `gitsema doctor`/`gitsema status` to inspect any backend. See [`docs/storage-backends-plan.md`](docs/storage-backends-plan.md).

---

## Command reference

All commands support a top-level `--verbose` flag (or `GITSEMA_VERBOSE=1`) for debug output. Run `gitsema <command> --help` for full flag details — the tables below summarize the most important options. Commands are grouped exactly as in `gitsema --help`.

### Setup & Infrastructure

| Command | Description |
|---|---|
| `gitsema config <action> [key] [value]` | Manage persistent configuration (`set`, `get`, `list`, `unset`) |
| `gitsema status [file]` | Show index status and database info, or status for a specific file |
| `gitsema doctor [options]` | Run index health checks (integrity, schema version, FTS backfill, scale warnings; `--extended` for model reachability/freshness) |
| `gitsema storage [info]` | Show the resolved storage backend/scope/location/FTS config (no connections opened) |
| `gitsema storage migrate --to <backend> [options]` | Copy the active index into another storage backend (sqlite/postgres/qdrant) |
| `gitsema models` | Manage embedding model configurations (list, add, remove, info); also manages LLM narrator/guide model configs via `--narrator`/`--guide` |
| `gitsema index` | Show index coverage (blob counts per model) |
| `gitsema index start [options]` | Perform indexing — walk Git history and embed all blobs |
| `gitsema setup` (alias: `gitsema quickstart`) | Guided onboarding wizard: detect provider, configure embedding model, select storage backend (sqlite/postgres/qdrant), index HEAD, and optionally configure a narrator/guide model |
| `gitsema remote-index <repoUrl>` | Ask a remote gitsema server to clone and index a Git repository |

#### `gitsema index start [options]`

Walk Git history and embed all blobs. Already-indexed blobs are skipped (dedup by blob hash).

| Flag | Default | Description |
|---|---|---|
| `--since <ref>` | last indexed commit | Date, tag, commit hash, or `"all"` for full re-index |
| `--max-commits <n>` | unlimited | Cap commits per run (for splitting large histories) |
| `--concurrency <n>` | `4` | Parallel embedding calls |
| `--embed-batch-size <n>` | — | Batch embedding requests |
| `--ext <exts>` | all | Only index these comma-separated extensions |
| `--max-size <size>` | `200kb` | Skip blobs larger than this |
| `--exclude <patterns>` | none | Skip paths containing these comma-separated substrings |
| `--include-glob <glob>` | — | Glob-based selective indexing |
| `--chunker <strategy>` | `file` | `file` \| `function` \| `fixed` |
| `--window-size <n>` | `1500` | Characters per chunk (fixed chunker) |
| `--overlap <n>` | `200` | Character overlap between adjacent fixed chunks |
| `--file <paths...>` | — | Index specific files from HEAD only |
| `--model <name>` | — | Model override for this run |
| `--allow-mixed` | off | Allow mixing models within one index |
| `--auto-build-vss [threshold]` | off | Build the VSS/HNSW ANN index after indexing |
| `--quantize` | off | Int8 scalar quantization of embeddings |
| `--profile <name>` | — | `speed` \| `balanced` \| `quality` preset |
| `--graph` | off | Extract structural references (imports/calls/extends/implements) for TS/TSX/JS/Python blobs into `structural_refs` (Phase 106 knowledge-graph track) |

The indexer applies a multi-level fallback chain: whole-file → function chunker → fixed windows (1500 chars → 800 chars) when a blob exceeds the embedding model's context limit.

Other `index` subcommands: `index export` / `index import` (bundle transfer), `index update-modules` (directory-centroid embeddings), `index build-vss` (build the ANN index).

#### `gitsema storage [info]`

Prints the resolved `storage.*` configuration — backend, scope, location, and FTS status — without opening any connections. Bare `gitsema storage` is an alias for `gitsema storage info`. Use `gitsema status`/`gitsema doctor` for row counts and health checks.

#### `gitsema storage migrate --to <backend> [options]`

Copies the active index into another storage backend (sqlite/postgres/qdrant) via the `StorageProfile` seam. Content-addressed and idempotent, so a migration is safe to re-run/resume after an interruption. Only `sqlite` sources are supported today.

| Flag | Description |
|---|---|
| `--to <backend>` | destination backend: `sqlite` \| `postgres` \| `qdrant` (required) |
| `--to-path <file>` | destination SQLite database file (for `--to sqlite`) |
| `--to-metadata-url <url>` | destination `postgres://...` connection string (for `--to postgres \| qdrant`) |
| `--to-vectors-url <url>` | destination Qdrant `http(s)://` URL (for `--to qdrant`) |
| `--to-vectors-api-key <key>` | Qdrant API key (for `--to qdrant`) |
| `--to-fts-backend <backend>` | destination FTS backend: `tsvector` \| `pg_search` \| `none` (default: `tsvector`) |

### Protocol Servers

| Command | Description |
|---|---|
| `gitsema tools mcp` | Start the MCP stdio server (AI tool interface) |
| `gitsema tools lsp [--tcp <port>]` | Start the LSP semantic hover server (JSON-RPC over stdio or TCP) |
| `gitsema tools serve [--port n] [--key token] [--ui]` | Start the HTTP API server (remote embedding backend) |

The old top-level `gitsema mcp`, `gitsema lsp`, `gitsema serve`, and `gitsema backfill-fts` still work as hidden backward-compat aliases.

`gitsema tools serve` defaults `POST /api/v1/remote/index` to **persistent** mode:
the cloned repo and its index are stored under `GITSEMA_DATA_DIR` (default
`~/.gitsema/data`) and reused on subsequent requests (fetch + incremental index
instead of a fresh clone + full reindex). The response includes a `repoId` you can
pass to `/api/v1/search`, `/api/v1/evolution/*`, `/api/v1/analysis/*`, and other
query routes to run them against that repo's index. Pass `persist: false` to fall
back to the legacy ephemeral (temp-dir, `GITSEMA_CLONE_KEEP`-governed) behavior.
Manage persisted repos with `gitsema repos list-persisted` and
`gitsema repos remove <repoId> [--purge]`. See
[`docs/features.md`](docs/features.md#persistent-server-side-repo-storage) for details.

### Search & Discovery

| Command | Description |
|---|---|
| `gitsema search <query> [options]` | Semantically search the index for blobs matching the query |
| `gitsema first-seen <query> [options]` | Find when a concept first appeared, sorted chronologically (earliest first) |
| `gitsema repl [options]` | Start an interactive semantic search session |
| `gitsema dead-concepts [options]` | Find historical concepts no longer in HEAD but semantically similar to current code |

#### `gitsema search <query> [options]`

| Flag | Default | Description |
|---|---|---|
| `-k, --top <n>` | `10` | Results to return |
| `--recent` | off | Blend cosine similarity with recency score |
| `--alpha <n>` | `0.8` | Cosine weight in blended score |
| `--before <date>` | — | Only blobs first seen before this date (YYYY-MM-DD or ISO 8601); alias of `--until` |
| `--after <date>` | — | Only blobs first seen after this date (YYYY-MM-DD or ISO 8601); alias of `--since` |
| `--since <date>` | — | Only blobs first seen at or after this date (YYYY-MM-DD or ISO 8601); alias of `--after` |
| `--until <date>` | — | Only blobs first seen before this date (YYYY-MM-DD or ISO 8601); alias of `--before` |
| `--weight-vector <n>` | `0.7` | Vector weight in three-signal ranking |
| `--weight-recency <n>` | `0.2` | Recency weight |
| `--weight-path <n>` | `0.1` | Path-relevance weight |
| `--group <mode>` | — | Collapse results by `file` \| `module` \| `commit` |
| `--chunks` | off | Include chunk-level embeddings |
| `--hybrid` | off | Combine vector + BM25 (FTS5); requires prior `gitsema backfill-fts` for older data |
| `--bm25-weight <n>` | `0.3` | BM25 weight in hybrid score |
| `--branch <name>` | — | Restrict results to blobs seen on this branch |
| `--vss` | off | Use the HNSW ANN index (requires prior `gitsema index build-vss`) |
| `--out <spec>` | — | Output spec (repeatable): `text\|json[:file]\|html[:file]\|markdown[:file]` |

#### `gitsema first-seen <query> [options]`

Same underlying search as `gitsema search`, but results are sorted by first-seen date (earliest first).

| Flag | Default | Description |
|---|---|---|
| `-k, --top <n>` | `10` | Results to return |
| `--branch <name>` | — | Restrict results to blobs seen on this branch |
| `--hybrid` | off | Blend vector similarity with BM25 keyword matching |
| `--bm25-weight <n>` | `0.3` | BM25 weight in hybrid score |
| `--include-commits` | off | Also search commit messages and show chronological commit results |
| `--vss` | off | Use the HNSW ANN index for approximate search |
| `--repos <ids>` | — | Comma-separated repo IDs to include (multi-repo search) |
| `--out <spec>` | — | Output spec (repeatable): `text\|json[:file]\|html[:file]\|markdown[:file]` |

### Analysis

| Command | Description |
|---|---|
| `gitsema triage <query> [options]` | Incident triage: composite workflow (first-seen, change-points, file-evolution, bisect, experts) |
| `gitsema policy-check [options]` | Run policy gates for drift, debt, and security scores (CI-friendly exit codes) |
| `gitsema ownership <query> [options]` | Show ownership heatmap for a concept (ownership confidence and trends) |
| `gitsema eval <file> [options]` | Evaluate retrieval quality against a JSONL file of (query, expectedPaths) pairs |
| `gitsema narrate [options]` | Return commit evidence (default) or an LLM-generated narrative of repository development history |
| `gitsema explain <topic> [options]` | Return matching commits (default) or an LLM-generated explanation/timeline for a bug, error, or topic |
| `gitsema guide [question] [options]` | Interactive LLM chat that answers questions about this repository, using gathered git context |

#### `gitsema narrate [options]` / `gitsema explain <topic> [options]`

Both commands are **safe-by-default**: with no narrator model configured (or without `--narrate`), they return raw commit evidence as JSON/text — no network calls are made. Pass `--narrate` (and configure a narrator model) to generate LLM prose instead.

| Flag | Default | Description |
|---|---|---|
| `--since <ref\|date>` | — | Only include commits after this ref or date |
| `--until <ref\|date>` | — | Only include commits before this ref or date |
| `--range <rev-range>` | — | Git revision range (e.g. `v1.0..HEAD`) (`narrate` only) |
| `--focus <area>` | `all` | Filter commits by area: `bugs`, `features`, `ops`, `security`, `deps`, `performance`, `all` (`narrate` only) |
| `--format <fmt>` | `md` | Output format when narrating: `md`, `text`, `json` (legacy: prefer `--out`) |
| `--out <spec>` | — | Output spec (repeatable): `text\|json[:file]\|markdown[:file]` (overrides `--format`) |
| `--max-commits <n>` | `500` | Maximum commits to analyse (`narrate` only) |
| `--narrator-model-id <id>` | — | `embed_config.id` of the narrator model to use (overrides active selection) |
| `--model <name>` | — | Narrator model name to use (overrides active selection) |
| `--narrate` | off | Call the configured LLM narrator and return prose (default: return evidence only) |
| `--evidence-only` | on | Return raw commit evidence without calling the LLM (this is the default) |

Configure a narrator model with `gitsema models add <name> --narrator --http-url <url> [--key <token>] --activate`, with a local Ollama model (`gitsema models add <name> --narrator --provider ollama [--global-name <tag>] --activate`, see "Ollama" below), or with a local CLI AI tool: `gitsema models add <name> --narrator --provider cli --cli-command <tool> [--cli-args "<args>"] --activate` (see "CLI-based AI tool backends" below).

#### `--narrate` on other commands

The same safe-by-default narration (no network unless `--narrate` is passed and a narrator model is configured) is also available as a `--narrate` flag on: `first-seen`, `branch-summary`, `merge-audit`, `merge-preview`, `dead-concepts`, `debt`, `doc-gap`, `security-scan`, `blame`/`semantic-blame`, `triage`, `impact`, `ownership`, `experts`, `author`, `contributor-profile`, `bisect`, `refactor-candidates`, `cherry-pick-suggest`, and `heatmap`. Each prints its normal output followed by an `=== LLM Narrative ===` section summarizing the result using the active narrator model.

#### `gitsema guide [question] [options]`

Interactive LLM chat that gathers repository context (recent commits, repo stats) and answers questions about the codebase. Falls back to the active narrator model if no guide model is configured, and prints the gathered context (without calling an LLM, no network access) if neither is configured.

When a guide (or fallback narrator) model is configured, `guide` runs a real **agentic tool-calling loop** (via `@jsilvanus/chattydeer`'s `runAgentLoop`): the LLM can call gitsema tools to gather additional evidence before answering, up to **5 roundtrips**. The tool registry (`src/core/narrator/guideTools.ts`) wires the **full gitsema analysis toolset** — the same ~36 capabilities exposed as MCP tools — grouped by category:

| Category | Tools |
|---|---|
| Repository (git-only) | `repo_stats`, `recent_commits`, `narrate_repo`, `explain_topic` |
| Search & discovery | `semantic_search`, `code_search`, `search_history`, `first_seen`, `multi_repo_search` |
| History & temporal drift | `file_evolution`, `concept_evolution`, `change_points`, `file_change_points`, `health_timeline` |
| Branch & merge | `branch_summary`, `merge_audit`, `merge_preview` |
| Ownership & expertise | `author`, `experts`, `ownership`, `contributor_profile` |
| Quality, debt & risk | `impact`, `dead_concepts`, `debt_score`, `doc_gap`, `security_scan` |
| Diff & blame | `semantic_diff`, `semantic_blame` |
| Clustering | `clusters`, `cluster_diff`, `cluster_timeline` |
| Compound workflows | `triage`, `workflow_run`, `policy_check`, `eval` |
| Administration | `index` |

Each tool has a corresponding entry in `src/core/narrator/interpretations.ts` describing its result shape and how to interpret it; this catalog is embedded directly in the guide's system prompt so the LLM knows what each result means (significant values, thresholds, caveats) and is also used to generate the "Interpreting gitsema tool results" section of `skill/gitsema-ai-assistant.md` (`pnpm gen:skill`).

Tools that require a `.gitsema` index (search, evolution, clustering, ownership, etc.) return `{"error": "..."}` gracefully if no index exists or the embedding provider is unreachable — the agent is instructed to fall back to git-only tools (`repo_stats`, `recent_commits`, `narrate_repo`, `explain_topic`) and tell the user to run `gitsema index` first. The `index` tool is mutating/expensive (admin category) and the agent is instructed to use it conservatively.

All outbound content (prompts, tool results) is passed through the same secret/PII redaction (`redactAll`) used by `narrate`/`explain` before it reaches the LLM.

| Flag | Description |
|---|---|
| `--guide-model-id <id>` | `embed_config.id` of the guide model to use |
| `--model <name>` | Guide/narrator model name to use |
| `--no-context` | Skip gathering git context (faster but less accurate) |
| `-i, --interactive` | Start an interactive REPL session (one question per line, multi-turn — the agent session is reused across turns) |

Configure a guide model with `gitsema models add <name> --guide --http-url <url> [--key <token>] --activate`, or with a local CLI AI tool: `gitsema models add <name> --guide --provider cli --cli-command <tool> [--use-mcp] --activate` (see "CLI-based AI tool backends" below).

**Ollama:** `--provider ollama` configures `narrate`/`explain`/`guide` against a local Ollama
server with no API key. It defaults `--http-url` to `http://localhost:11434` (no trailing
`/v1` — both the narrator and `@jsilvanus/chattydeer` append `/v1/chat/completions`
themselves) and sends the local model name as the `model` field in chat requests, so the
name (or `--global-name`) must match a pulled Ollama tag. The agentic `guide` loop needs a
tool-calling-capable model (e.g. `llama3.1`, `qwen2.5`):

```bash
ollama pull llama3.1
gitsema models add llama3.1 --guide --provider ollama --activate
gitsema guide "what changed recently?"

# Or use a local alias mapped to the Ollama tag via --global-name:
gitsema models add ol-guide --guide --provider ollama --global-name llama3.1 --activate
```

If you omit `<name>` with `--provider ollama`, gitsema lists the models available on your
Ollama server:

```bash
gitsema models add --provider ollama
```

#### CLI-based AI tool backends

Instead of an HTTP endpoint, `narrate`/`explain`/`guide` can shell out to a local CLI AI coding agent (Claude Code, Codex CLI, GitHub Copilot CLI, or any other tool already installed and authenticated on your machine):

```bash
# One-shot narration via the local `claude` CLI
gitsema models add claude-cli --narrator --provider cli --cli-command claude --activate
gitsema narrate --narrate

# Agentic guide, with gitsema's own MCP server exposed to the CLI tool's agent loop
gitsema models add claude-cli --guide --provider cli --cli-command claude --use-mcp --activate
gitsema guide "what changed recently?"
```

| Flag | Description |
|---|---|
| `--provider cli` | Use a local CLI tool instead of an HTTP endpoint |
| `--cli-command <tool>` | Executable to spawn (e.g. `claude`, `codex`, `copilot`/`gh`); required with `--provider cli` |
| `--cli-args "<args>"` | Extra fixed arguments inserted before the prompt (space-separated) |
| `--use-mcp` | Guide only: write a temporary MCP config exposing gitsema's `tools mcp` server and pass `--mcp-config`/`--allowedTools mcp__gitsema__*`, so the CLI tool's own agent loop can call gitsema's analysis tools directly |

For `narrate`/`explain`, the system+user prompt is combined, redacted, and passed one-shot (e.g. `claude -p "<prompt>" --output-format json`); the result is parsed from stdout. For `guide -i` (interactive, multi-turn), conversational context is preserved via the CLI tool's session-resume flag (e.g. Claude Code's `--resume <session-id>`), extracted from the previous turn's output.

Built-in adapters: `claude` (full support, including `--mcp-config` and `--resume`), `codex` (`codex exec`, best-effort/experimental MCP support), `copilot`/`gh` (`copilot explain`, one-shot only — no MCP/session support). Any other `--cli-command` falls back to a generic adapter (`<tool> [cliArgs...] "<prompt>"`, raw stdout as prose).

#### `gitsema policy-check [options]`

CI policy gate over drift, debt, and security thresholds.

| Flag | Description |
|---|---|
| `--max-drift <n>` | Fail if any concept change-point distance exceeds `n` (cosine distance, 0–2) |
| `--max-debt-score <n>` | Fail if aggregate debt score exceeds `n` |
| `--min-security-score <n>` | Fail if any security finding similarity exceeds `n` (cosine similarity, 0–1) |
| `--query <text>` | Concept query (required for the drift gate) |
| `--out <spec>` | Output spec (repeatable): `text\|json[:file]` |

**Exit codes:** `0` = ok, `1` = runtime error, `2` = usage error, `3` = gate failed. The same exit-code contract applies to all CI-facing commands: `ci-diff`, `regression-gate`, `code-review`, and `policy-check`.

### File History

| Command | Description |
|---|---|
| `gitsema file-evolution <path> [options]` | Track semantic drift of a file over its Git history (see also: `file-diff`, `evolution`) |
| `gitsema file-diff <ref1> <ref2> <path>` | Compute semantic diff between two versions of a file |
| `gitsema blame <file>` (alias: `semantic-blame`) | Show semantic origin of each logical block in a file — nearest-neighbor blame |
| `gitsema impact <path>` | Compute semantically similar blobs across the codebase to highlight refactor impact |

#### `gitsema file-evolution <path> [options]`

Track semantic drift of a single file across its Git history.

| Flag | Default | Description |
|---|---|---|
| `--threshold <n>` | `0.3` | Cosine distance (0–2) above which a version is flagged as a large change |
| `--level <level>` | `file` | `file` \| `symbol` — symbol uses per-symbol centroid embeddings |
| `--dump [file]` | — | Output structured JSON; writes to `<file>` or stdout |
| `--html [file]` | — | Output an interactive HTML visualization |
| `--out <spec>` | — | Output spec (repeatable): `text\|json[:file]\|html[:file]\|markdown[:file]` (overrides `--dump`/`--html`) |
| `--include-content` | off | Add stored file text per version in JSON (requires `--dump`) |
| `--alerts [n]` | `5` | Show the top-N largest semantic jumps with author and commit link |
| `--branch <name>` | — | Restrict evolution to blobs seen on this branch |
| `--narrate` | off | Generate an LLM narrative summary of semantic shifts (requires `GITSEMA_LLM_URL`) |

### Concept History

| Command | Description |
|---|---|
| `gitsema evolution <query> [options]` (alias: `concept-evolution`) | Trace how a semantic concept evolved across the entire codebase history |
| `gitsema diff <ref1> <ref2> <query>` | Compute a conceptual/semantic diff of a topic across two git refs — gained, lost, and stable concepts |
| `gitsema author <query> [options]` | Rank authors by semantic contribution to a concept |

#### `gitsema evolution <query> [options]`

| Flag | Default | Description |
|---|---|---|
| `-k, --top <n>` | `50` | Top-matching blobs to include |
| `--threshold <n>` | `0.3` | Large-change flag threshold (cosine distance, 0–2) |
| `--dump [file]` | — | Structured JSON output |
| `--include-content` | off | Add stored file text (requires `--dump`) |

### Cluster Analysis

| Command | Description |
|---|---|
| `gitsema clusters [options]` | Cluster all blob embeddings into semantic regions and display a concept graph |
| `gitsema cluster-diff <ref1> <ref2>` | Compare semantic clusters between two points in history |
| `gitsema cluster-timeline [options]` | Show how semantic clusters shifted over commit history (multi-step timeline) |
| `gitsema branch-summary <branch>` | Generate a semantic summary of what a branch is about compared to its base branch |
| `gitsema merge-audit <branch-a> <branch-b>` | Detect semantic collisions between two branches — concept-level conflicts textual diff can't find |
| `gitsema merge-preview <branch>` | Predict semantic cluster shifts after merging a branch |

### Change Detection

| Command | Description |
|---|---|
| `gitsema change-points <query> [options]` | Detect conceptual change points for a semantic query across commit history |
| `gitsema file-change-points <path> [options]` | Detect semantic change points in a file's Git history |
| `gitsema cluster-change-points [options]` | Detect change points in the repo's cluster structure across commit history |

### Code Quality

| Command | Description |
|---|---|
| `gitsema code-search <snippet> [options]` | Find code semantically similar to a given snippet |
| `gitsema security-scan [options]` | Scan the codebase for common security patterns (semantic + structural heuristics) |
| `gitsema health [options]` | Show codebase health timeline |
| `gitsema debt [options]` | Score technical debt across the codebase |
| `gitsema code-review [options]` | Semantic code review: find historical analogues for changed code and flag regressions |
| `gitsema refactor-candidates [options]` | Find pairs of symbols/chunks/files semantically similar enough to be refactoring candidates |
| `gitsema lifecycle <query> [options]` | Analyze the lifecycle stages (born → growing → mature → declining → dead) of a semantic concept |
| `gitsema doc-gap [options]` | Find undocumented code by comparing code blobs against prose/documentation embeddings |

`code-review` follows the same exit-code contract as `policy-check` (0 ok / 1 runtime error / 2 usage error / 3 gate failed).

### Workflow & CI

| Command | Description |
|---|---|
| `gitsema repos` | Manage tracked repositories for multi-repo indexing |
| `gitsema watch` | Manage saved searches and watch mode notifications |
| `gitsema pr-report [options]` | Compose a semantic PR report: diff, impacted modules, change-points, reviewer suggestions |
| `gitsema regression-gate [options]` | CI gate: fail if key concepts drift beyond threshold between two refs |
| `gitsema bisect <good> <bad> <query>` | Semantic git bisect — binary search to find where a concept diverged from a "good" baseline |
| `gitsema ci-diff [options]` | CI/CD semantic diff — compare semantic content between two Git refs, non-zero exit when concepts changed |
| `gitsema contributor-profile <author> [options]` | Compute a contributor semantic profile and show top-N blobs they specialize in |
| `gitsema cherry-pick-suggest <query> [options]` | Suggest commits to cherry-pick based on semantic similarity to a query |

`regression-gate` and `ci-diff` follow the same exit-code contract as `policy-check` (0 ok / 1 runtime error / 2 usage error / 3 gate failed) — useful for distinguishing "drift detected" from "provider unreachable" in CI pipelines.

### Workflows

| Command | Description |
|---|---|
| `gitsema workflow list` | List available productized workflow templates |
| `gitsema workflow run <name>` | Run a named workflow template (`pr-review` \| `incident` \| `release-audit`) |

### Repo Insights

| Command | Description |
|---|---|
| `gitsema cross-repo-similarity <query> [options]` | Compare semantic similarity of a concept across two separately indexed repos |
| `gitsema experts [options]` | Show top contributors ranked by blob count and the semantic areas they worked on |

### Visualization

| Command | Description |
|---|---|
| `gitsema map` | Output a JSON representation of semantic clusters and blob assignments |
| `gitsema heatmap [options]` | Show semantic activity heatmap — distinct blob changes by time period (week or month) |
| `gitsema project [options]` | Compute 2D random projections of all embeddings for the web UI (requires prior `gitsema index`) |

---

## Database & schema

- **Location:** `.gitsema/index.db` (relative to the indexed repo root) — add `.gitsema/` to `.gitignore`
- **Engine:** SQLite via `better-sqlite3`, WAL mode enabled
- **Current schema version:** 21

See [`CLAUDE.md`](CLAUDE.md) for the full schema table and migration history.

---

## MCP integration

Gitsema ships an MCP stdio server exposing 32 tools (semantic search, temporal analysis, clustering, security/debt scans, workflow automation, and more) to Claude and other MCP-compatible AI clients:

```bash
gitsema tools mcp
```

See [`CLAUDE.md`](CLAUDE.md#mcp-integration) for the full tool list and VS Code registration instructions, and [`docs/features.md`](docs/features.md#mcp-tools) for tool-by-tool descriptions.

---

## Further documentation

| Document | Purpose |
|---|---|
| [`docs/features.md`](docs/features.md) | Comprehensive feature catalog grouped by area (indexing, search, MCP tools, HTTP API, etc.) |
| [`docs/PLAN.md`](docs/PLAN.md) | Full development roadmap: phase history, current status, backlog, and planned phases |
| [`CLAUDE.md`](CLAUDE.md) | Architecture, schema, configuration, and development conventions |
| [`skill/gitsema-ai-assistant.md`](skill/gitsema-ai-assistant.md) | AI workflow skill/playbook for operating gitsema in coding tasks |
