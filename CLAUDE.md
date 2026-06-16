## Canonical documentation

These are the four canonical reference documents for this repository. Keep them accurate and up-to-date. 

| [`README.md`](README.md) | User-facing overview: installation, quick start, configuration, command reference |
| [`docs/features.md`](docs/features.md) | Comprehensive feature catalog grouped by area (indexing, search, MCP tools, HTTP API, etc.) |
| [`docs/PLAN.md`](docs/PLAN.md) | Full development roadmap: phase history, current status, backlog, and planned phases |
| [`skill/gitsema-ai-assistant.md`](skill/gitsema-ai-assistant.md) | AI workflow skill/playbook for operating gitsema in coding tasks |
| [`docs/parity.md`](docs/parity.md) | **Tool parity & flag coherence:** canonical matrix of tool availability across CLI/REPL/Guide/MCP/HTTP and flag implementation consistency; update when tools or interfaces change |

The latest review is here. Do not edit the review file, but update that file with new review file after a review.

| Document | Purpose |
|---|---|
| [`docs/review9.md`](docs/review9.md) | Latest strategic review: LLM layer, pluggable storage backends, server-side persistence, docs parity |

When implementing a new feature or phase:
1. Add the feature to **`docs/features.md`** under the relevant group.
2. Update the command/option tables in **`README.md`** if the feature adds a new command or flag.
3. Mark the phase as completed in **`docs/PLAN.md`** and note any deviations from the original spec.
4. **Update `docs/parity.md`** if the change affects tool availability across interfaces (CLI/REPL/Guide/MCP/HTTP) or adds/modifies command flags. See the "Maintenance & Governance" section in parity.md.
5. Use latest review when starting the next iteration of development.
6. **Add a changeset** describing the change (see "Releases & changesets" below). Do **not** run `npm version` or push `v*` tags manually — versioning and publishing are handled by changesets.

---

## Releases & changesets

This repo uses [changesets](https://github.com/changesets/changesets) for versioning, `CHANGELOG.md` generation, and npm publishing (OIDC trusted publishing — no npm token).

- **Every user-facing change must include a changeset.** Run `pnpm exec changeset` (interactive), or create `.changeset/<kebab-name>.md` directly:

  ```md
  ---
  "gitsema": minor
  ---

  One or two sentences describing the change from the user's perspective.
  ```

  Use `patch` for fixes, `minor` for features/phases, `major` for breaking changes. Write the summary for end users — it becomes the CHANGELOG entry.
- **Release flow:** merging to `main` runs `release.yml`, which lets `changesets/action` accumulate pending changesets into a **"chore(release): version packages"** PR (bumps `package.json`, updates `CHANGELOG.md`). Merging *that* PR publishes to npm automatically.
- Internal-only changes (CI tweaks, refactors with no behavior change, docs typos) may omit a changeset.

---

## Project overview

`gitsema` is a **content-addressed semantic index synchronized with Git's object model**. It walks a repository's full history, embeds every unique blob (file snapshot) exactly once, and enables semantic search across time. The unit of identity is the blob SHA-1 hash — not the file path, not the commit. Identical content is deduplicated automatically regardless of how many commits reference it.

**Core capabilities:**
- Semantic search over all of Git history (not just HEAD)
- Temporal analysis: `first-seen`, `file-evolution`, `evolution` (concept-level)
- Hybrid search (vector similarity + BM25 keyword matching)
- Multiple chunking strategies (whole-file, function boundaries, fixed windows)
- Multi-model routing (separate models for code vs. prose)
- MCP server exposing all capabilities to Claude and other AI clients

---

## Build & run

**Requirements:** Node.js 20+, Git on `PATH`, and an embedding backend (Ollama or any OpenAI-compatible HTTP API).

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

**Version:**
```bash
gitsema -V   # reads version from package.json at runtime
```

---

## Testing

```bash
pnpm test                   # run full test suite (vitest run)
pnpm test -- <file>         # run a specific test file (e.g. pnpm test -- chunking.test.ts)
pnpm test -- --watch        # watch mode during development
```

**Structure:**
- `tests/*.test.ts` — unit tests (mocked dependencies)
- `tests/integration/` — end-to-end tests (real Git repos, real SQLite, mock embedding provider)
- `tests/serverRoutes.test.ts` — HTTP routes via `supertest`

**Patterns:**
- Mock modules with `vi.mock()`, spy with `vi.fn()`, clean up with `vi.restoreAllMocks()` in `afterEach`
- Integration tests use `mkdtempSync()` + `rmSync()` for isolated temp Git repos
- `withDbSession()` helper creates isolated temp SQLite DBs per test
- **Always close `session.rawDb` (`better-sqlite3`) before `rmSync()`-ing its temp
  directory.** On Windows, `rmSync` on a directory containing an open SQLite handle
  fails with `EBUSY: resource busy or locked, unlink '...\test.db'` — this passes on
  Linux/macOS (CI runs `ubuntu-latest` by default) but fails the Windows CI job. Call
  `session.rawDb.close()` (e.g. in a `try`/`finally` around `withDbSession()`) before
  the test's temp dir is removed in `afterEach`.

---

## CI/CD

- **ci.yml** — triggers on push to `main` and on PRs: `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm test` (Node 20 / pnpm 9)
- **release.yml** — triggers on pushes to `main`: runs CI, then `changesets/action` maintains the "chore(release): version packages" PR; merging that PR publishes to npm (OIDC trusted publishing)

---

## CLI commands

All commands support a top-level `--verbose` flag (or `GITSEMA_VERBOSE=1`) for debug output.

### `gitsema status [file]`
Show index statistics and database path. Pass a file path for per-file info.

### `gitsema index [options]`
Walk Git history and embed all blobs. Already-indexed blobs are skipped (dedup by blob hash).

| Flag | Default | Description |
|---|---|---|
| `--since <ref>` | last indexed commit | Date, tag, commit hash, or `"all"` for full re-index |
| `--max-commits <n>` | unlimited | Cap commits per run (for splitting large histories) |
| `--concurrency <n>` | `4` | Parallel embedding calls |
| `--ext <exts>` | all | Only index these comma-separated extensions |
| `--max-size <size>` | `200kb` | Skip blobs larger than this |
| `--exclude <patterns>` | none | Skip paths containing these comma-separated substrings |
| `--chunker <strategy>` | `file` | `file` \| `function` \| `fixed` |
| `--window-size <n>` | `1500` | Characters per chunk (fixed chunker) |
| `--overlap <n>` | `200` | Character overlap between adjacent fixed chunks |
| `--file <paths...>` | — | Index specific files from HEAD only |
| `--graph` | off | Extract structural references (imports/calls/extends/implements) for TS/TSX/JS/Python blobs into `structural_refs` (Phase 106 knowledge-graph track) |

The indexer applies a multi-level fallback chain: whole-file → function chunker → fixed windows (1500 chars → 800 chars) when a blob exceeds the embedding model's context limit.

### `gitsema search <query> [options]`

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
| `--hybrid` | off | Combine vector + BM25 (FTS5) |
| `--bm25-weight <n>` | `0.3` | BM25 weight in hybrid score |
| `--branch <name>` | — | Restrict results to blobs seen on this branch |

### `gitsema first-seen <query> [options]`
Find when a concept first appeared — same as `search` but sorted chronologically (earliest first).

| Flag | Default | Description |
|---|---|---|
| `-k, --top <n>` | `10` | Number of results to return |
| `--branch <name>` | — | Restrict results to blobs seen on this branch |
| `--hybrid` | off | Blend vector similarity with BM25 keyword matching (requires prior `backfill-fts`) |
| `--bm25-weight <n>` | `0.3` | BM25 weight in hybrid score |
| `--include-commits` | off | Also search commit messages and show chronological commit results |
| `--dump [file]` | — | Output structured JSON; writes to `<file>` or stdout |
| `--vss` | off | Use the usearch HNSW ANN index for approximate search |
| `--html [file]` | — | Output interactive HTML; writes to `<file>` or `first-seen.html` |
| `--out <spec>` | — | Output spec (repeatable): `text\|json[:file]\|html[:file]\|markdown[:file]` (overrides `--dump`/`--html`) |
| `--repos <ids>` | — | Comma-separated repo IDs to include in search (multi-repo) |

### `gitsema file-evolution <path> [options]`
Track semantic drift of a single file across its Git history.

| Flag | Default | Description |
|---|---|---|
| `--threshold <n>` | `0.3` | Cosine distance (0–2) above which a version is flagged as a large change |
| `--level <level>` | `file` | `file` or `symbol` — symbol uses per-symbol centroid embeddings |
| `--dump [file]` | — | Output structured JSON; writes to `<file>` or stdout |
| `--html [file]` | — | Output an interactive HTML visualization |
| `--out <spec>` | — | Output spec (repeatable): `text\|json[:file]\|html[:file]\|markdown[:file]` (overrides `--dump`/`--html`) |
| `--include-content` | off | Add stored file text per version in JSON (requires `--dump`) |
| `--alerts [n]` | `5` | Show the top-N largest semantic jumps with author and commit link |
| `--branch <name>` | — | Restrict evolution to blobs seen on this branch |
| `--narrate` | off | Generate an LLM narrative summary of semantic shifts (requires `GITSEMA_LLM_URL`) |

### `gitsema evolution <query> [options]`
Trace how a semantic concept evolved across the entire codebase history. (`concept-evolution` is a backward-compat alias.)

| Flag | Default | Description |
|---|---|---|
| `-k, --top <n>` | `50` | Top-matching blobs to include |
| `--threshold <n>` | `0.3` | Large-change flag threshold |
| `--dump [file]` | — | Structured JSON output |
| `--include-content` | off | Add stored file text (requires `--dump`) |

### `gitsema file-diff <ref1> <ref2> <path>`
Compute cosine distance between two versions of a file. `--neighbors <n>` shows nearest-neighbor blobs for each version.

### `gitsema diff <ref1> <ref2> <query>`
Compute a conceptual/semantic diff of a topic across two git refs — shows gained, lost, and stable concepts.

### `gitsema policy-check [options]`
Run policy gates for drift, debt, and security scores. Exit codes: `0` = ok, `1` = runtime error, `2` = usage error, `3` = gate failed. The same exit-code contract applies to `ci-diff`, `regression-gate`, and `code-review`.

### `gitsema tools <server>`
Preferred entry point for all long-running protocol servers. Subcommands:

| Subcommand | Description |
|---|---|
| `gitsema tools mcp` | Start the MCP stdio server (AI tool interface) |
| `gitsema tools lsp [--tcp <port>]` | Start the LSP semantic hover server (JSON-RPC over stdio or TCP) |
| `gitsema tools serve [--port n] [--key token] [--ui]` | Start the HTTP API server (remote embedding backend) |

The old top-level `gitsema mcp`, `gitsema lsp`, and `gitsema serve` still work as hidden backward-compat aliases.

### `gitsema config <action> [key] [value]`
Manage persistent configuration (set/get/list/unset). Stored in `.gitsema/config.json` (repo-level, default) or `~/.config/gitsema/config.json` (global, `--global`). Env vars override config file values.

Supported dot-notation keys for command defaults (see `src/core/config/configManager.ts`): `provider`, `model`, `textModel`, `codeModel`, `httpUrl`, `apiKey`, `llmUrl`, `llmModel`, `verbose`, `logMaxBytes`, `servePort`, `serveKey`, `remoteUrl`, `remoteKey`, `index.concurrency`, `index.maxCommits`, `index.ext`, `index.maxSize`, `index.exclude`, `index.chunker`, `index.windowSize`, `index.overlap`, `search.top`, `search.hybrid`, `search.recent`, `search.weightVector`, `search.weightRecency`, `search.weightPath`, `evolution.threshold`, `clusters.k`, `hooks.enabled`, `vscode.mcp`, `vscode.lsp`, and more. Use `gitsema config list` to see all active values and their sources.

### `gitsema index backfill-fts`
Populate FTS5 content for blobs indexed before Phase 11 (when FTS5 support was added). Required to use `--hybrid` search on older index entries. The top-level `gitsema backfill-fts` is a hidden backward-compat alias.

### `gitsema index <maintenance subcommand>`
Maintenance operations on the active index, grouped under `gitsema index`:

| Subcommand | Description |
|---|---|
| `gitsema index doctor [--lsp] [--extended]` | Integrity checks, schema/provenance checks, index health report |
| `gitsema index vacuum` | `VACUUM`/`ANALYZE` the SQLite database |
| `gitsema index gc [--dry-run]` | Garbage-collect unreachable blob records |
| `gitsema index rebuild-fts [-y]` | Rebuild the FTS5 index from stored data |
| `gitsema index backfill-fts` | Populate FTS5 content for pre-Phase-11 entries |
| `gitsema index update-modules` | Recalculate directory centroid embeddings |
| `gitsema index clear-model <model> [-y]` | Delete stored embeddings/cache for a model |
| `gitsema index build-vss [--model] [--ef-construction] [--M]` | Build a usearch HNSW ANN index for fast approximate search |

Older top-level forms (`gitsema doctor`, `vacuum`, `gc`, `rebuild-fts`, `update-modules`, `clear-model`, `build-vss`) remain as hidden, deprecated aliases.

### `gitsema storage <subcommand>`
Manage the pluggable storage backend (Phase 101–103). Backends: `sqlite` (default), `postgres` (+ pgvector), `qdrant` (vectors) + Postgres metadata. Selected via `storage.*` config keys / `GITSEMA_STORAGE_*` env vars (see Configuration).

| Subcommand | Description |
|---|---|
| `gitsema storage info` (default) | Show the resolved backend/scope/location — no connections opened |
| `gitsema storage migrate --to <sqlite\|postgres\|qdrant> [--to-path] [--to-metadata-url] [--to-vectors-url] [--to-vectors-api-key] [--to-fts-backend]` | Copy the active index into another backend; resumable, safe to re-run. Only sqlite sources are supported today. |

### `gitsema setup` / `gitsema quickstart`
Guided onboarding wizard (aliases of each other): detects an embedding provider, configures a model, lets you select a storage backend, and indexes HEAD in one step.

### `gitsema repl`
Interactive semantic search REPL — a query loop sharing one embedding provider/connection across queries.

### `gitsema eval <file>`
Evaluate retrieval quality (precision@k, recall@k, MRR) against a JSONL file of `{query, expectedPaths}` test cases.

### `gitsema regression-gate [options]` / `gitsema code-review [options]`
CI gates: `regression-gate` fails if key concepts drift beyond a threshold between two refs; `code-review` finds historical analogues for changed code and flags regressions. Same exit-code contract as `policy-check` (0/1/2/3).

### `gitsema bisect <good> <bad> <query>`
Semantic git bisect — binary search over commit history to find where a concept diverged from a "good" baseline.

### `gitsema narrate [options]`
Return commit evidence (default, no LLM call) or an LLM-generated narrative of repository development history. Evidence-only mode is safe-by-default — no network calls unless `--narrate` is passed and a narrator model is configured (`gitsema models add <name> --narrator --http-url <url> --activate`). Supports `--since`/`--until`/`--range`, `--focus`, `--format md|text|json`, and `--out <spec>`.

### `gitsema explain <topic> [options]`
Return matching commits (default, no LLM call) or an LLM-generated explanation/timeline for a bug, error, or topic. Same safe-by-default and narrator-model conventions as `narrate`.

### `gitsema guide [question] [options]`
Interactive LLM chat that answers questions about the repository, using the active "guide" model config (falls back to the active narrator model). Prints gathered git context even when no LLM is configured (no network access). When a model is configured, runs a real agentic tool-calling loop (`@jsilvanus/chattydeer` `runAgentLoop`, maxRoundtrips 5) against the full `GUIDE_TOOLS` registry in `src/core/narrator/guideTools.ts` (49 tools, covering search, history, branch/merge, ownership, quality, diff/blame, clustering, workflow, structural graph, admin — including the Phase 110 `call_graph`/`blast_radius`/`hotspots` structural tools; Phase 104 is closing the remaining gaps). Index-gated tools return `{error}` gracefully when no `.gitsema` index exists. Supports `-i/--interactive` for a multi-turn REPL session (one agent session reused across turns).

---

## Architecture

```
git repo
   ↓
[ src/core/git/ ]          revList.ts   — streams (blobHash, path) via git rev-list --objects
   │                        showBlob.ts  — fetches content via git cat-file blob
   │                        commitMap.ts — maps commit hashes to timestamps + blobs
   │                        walker.ts    — Git tree walking helpers
   ↓
[ src/core/indexing/ ]     deduper.ts        — skips already-indexed blob hashes
   │                        indexer.ts        — orchestrates the full pipeline (~400 LOC)
   │                        blobStore.ts      — transactional SQLite writes
   │                        remoteIndexer.ts  — delegates embedding to remote HTTP server
   │                        backfillFts.ts    — backfills FTS5 content for older index entries
   ↓
[ src/core/chunking/ ]     fileChunker / functionChunker / fixedChunker
   ↓
[ src/core/embedding/ ]    provider.ts  — EmbeddingProvider interface
   │                        local.ts     — OllamaProvider (localhost:11434)
   │                        http.ts      — HttpProvider (OpenAI-compatible)
   │                        router.ts    — RoutingProvider (code vs. text per file type)
   │                        fileType.ts  — categorises files by extension (code vs. prose)
   ↓
[ src/core/db/ ]           schema.ts   — Drizzle ORM table definitions
   │                        sqlite.ts   — connection, WAL mode, versioned migrations, FTS5 init
   ↓
[ src/core/storage/ ]     types.ts          — MetadataStore / VectorStore / FtsStore interfaces (async)
   │                        sqlite/           — default backend, wraps src/core/db
   │                        postgres/         — Postgres metadata + pgvector vector store
   │                        qdrant/           — Qdrant vector store (+ Postgres metadata/FTS)
   │                        resolveProfile.ts — picks backend(s) from storage.* config / GITSEMA_STORAGE_*
   │                        doctor.ts, migrate.ts — cross-store health checks and `storage migrate`
   ↓
[ src/core/search/ ]       analysis/vectorSearch.ts  — cosine similarity, three-signal ranking
   │                        analysis/hybridSearch.ts  — vector + BM25 fusion
   │                        analysis/booleanSearch.ts — AND/OR/NOT query composition
   │                        analysis/resultCache.ts   — query result caching
   │                        temporal/evolution.ts     — file/concept drift timelines
   │                        temporal/timeSearch.ts    — date parsing, recency scoring
   │                        temporal/changePoints.ts  — change-point detection
   │                        temporal/healthTimeline.ts — codebase health metrics by time bucket
   │                        clustering/clustering.ts  — k-means clustering
   │                        ranking.ts                — result formatting and grouping
   │                        (ungrouped: authorSearch.ts, impact.ts, mergeAudit.ts, debtScoring.ts,
   │                         experts.ts, cherryPick.ts, semanticDiff.ts, semanticBlame.ts, etc.)
   ↓
[ src/cli/ ]               index.ts + commands/*.ts  — Commander.js CLI
[ src/mcp/ ]               server.ts                 — MCP stdio server
[ src/server/ ]            app.ts + routes/ + middleware/  — HTTP API server (remote backend)
[ src/client/ ]            remoteClient.ts            — client for remote server mode
```

**Key data flow (indexing):**
1. `revList` streams `(blobHash, path)` pairs — one pass, memory-efficient
2. `deduper` skips blobs already in the DB (content-addressed dedup)
3. `showBlob` fetches content (size-capped at `--max-size`)
4. `chunker` splits content by strategy
5. `embedding provider` computes vectors (parallel, `p-limit` throttled)
6. `blobStore` writes blobs, embeddings, paths, FTS5 content in transactions
7. `markCommitIndexed` records progress for incremental resume

**Key data flow (search):**
1. Embed query string with text provider
2. `vectorSearch` computes cosine similarity to all stored vectors
3. Optionally: time-filter, recency blend, three-signal ranking
4. Optionally: hybrid re-rank via FTS5 BM25
5. Format and group results

---

## Configuration

Configuration is via environment variables or the `gitsema config` command (persists to `.gitsema/config.json`). Environment variables always take precedence.

| Variable | Default | Description |
|---|---|---|
| `GITSEMA_PROVIDER` | `ollama` | `ollama` or `http` |
| `GITSEMA_MODEL` | `nomic-embed-text` | Default embedding model |
| `GITSEMA_TEXT_MODEL` | `$GITSEMA_MODEL` | Model for prose/docs |
| `GITSEMA_CODE_MODEL` | `$GITSEMA_TEXT_MODEL` | Model for source code files |
| `GITSEMA_HTTP_URL` | *(required if http)* | Base URL of OpenAI-compatible API |
| `GITSEMA_API_KEY` | *(optional)* | Bearer token for HTTP provider |
| `GITSEMA_VERBOSE` | off | Set to `1` for debug logging |
| `GITSEMA_LOG_MAX_BYTES` | `1048576` | Log rotation threshold (1 MB) |
| `GITSEMA_SERVE_PORT` | `4242` | Port for `gitsema tools serve` HTTP server |
| `GITSEMA_SERVE_KEY` | *(optional)* | Bearer token required by `gitsema tools serve` |
| `GITSEMA_LLM_URL` | *(optional)* | OpenAI-compatible URL for `--narrate` LLM summaries |
| `GITSEMA_DATA_DIR` | `~/.gitsema/data` | Root directory for `gitsema tools serve`'s persisted repo clones + index DBs (`repos/<repoId>/{repo,index.db}`, `registry.db`) |
| `GITSEMA_STORAGE_BACKEND` | `sqlite` | `sqlite` \| `postgres` \| `qdrant` — selects the storage profile (Phase 101–103) |
| `GITSEMA_STORAGE_SCOPE` | *(optional)* | Scoping/namespace for shared backends (e.g. multi-repo Postgres/Qdrant) |
| `GITSEMA_STORAGE_NAME` | *(optional)* | Logical name for the storage profile |
| `GITSEMA_STORAGE_METADATA_URL` | *(required for postgres/qdrant)* | Postgres connection string for the `MetadataStore` (and `FtsStore` via tsvector) |
| `GITSEMA_STORAGE_VECTORS_URL` | *(required for qdrant)* | Qdrant `http(s)://` URL for the `VectorStore` |
| `GITSEMA_STORAGE_VECTORS_API_KEY` | *(optional)* | Qdrant API key |
| `GITSEMA_STORAGE_FTS_BACKEND` | `tsvector` | `tsvector` \| `pg_search` \| `none` — FTS backend for non-sqlite profiles |
| `GITSEMA_STORAGE_FTS_URL` | *(optional)* | Override connection string for the `FtsStore` |

**Ollama quick start:**
```bash
ollama pull nomic-embed-text
gitsema index
```

**OpenAI example:**
```bash
export GITSEMA_PROVIDER=http
export GITSEMA_HTTP_URL=https://api.openai.com
export GITSEMA_MODEL=text-embedding-3-small
export GITSEMA_API_KEY=sk-...
gitsema index
```

**Multi-model routing:** Set `GITSEMA_CODE_MODEL` to a different model than `GITSEMA_TEXT_MODEL` to use separate models for code and prose. When they match (default), a single provider is used.

---

## Database

- **Location (default sqlite backend):** `.gitsema/index.db` (relative to the indexed repo root)
- **Engine:** SQLite via `better-sqlite3`, WAL mode enabled
- **ORM:** Drizzle ORM (`src/core/db/schema.ts`)
- **Add to `.gitignore`:** `.gitsema/`

**Pluggable storage backends (Phase 101–103):** all reads/writes go through async `MetadataStore` / `VectorStore` / `FtsStore` interfaces (`src/core/storage/types.ts`). The default `sqlite` backend wraps the schema below; `postgres` routes metadata + FTS through Postgres (pgvector for vectors), and `qdrant` uses Qdrant for vectors with Postgres for metadata/FTS. Select via `storage.*` config or `GITSEMA_STORAGE_*` env vars (see Configuration), inspect with `gitsema storage info`, and copy between backends with `gitsema storage migrate`.

**Schema overview (current schema v26):**

| Table | Purpose |
|---|---|
| `blobs` | Blob registry (hash, size, indexed_at) |
| `embeddings` | Whole-file embedding per blob (Float32 bytes, model name, optional quantization columns) |
| `chunks` | Sub-file fragments (start/end line, blob FK) |
| `chunk_embeddings` | Per-chunk embedding |
| `paths` | blob_hash → file path (one blob can map to many paths) |
| `commits` | Commit hash, timestamp, first-line message |
| `blob_commits` | Many-to-many blob ↔ commit join |
| `indexed_commits` | Tracks which commits have been fully processed (incremental resume) |
| `blob_fts` | FTS5 virtual table for BM25 hybrid search |
| `blob_branches` | Maps blobs to branch names |
| `repos` | Multi-repo registry (Phase 41); persistent server-side repo storage columns (normalized_url, clone_path, last_indexed_at, ephemeral) added in v23 |
| `query_embeddings` | Query embedding cache (avoids re-embedding identical queries) |
| `symbols` | Symbol-level index entries (function/class boundaries); path-free `qualified_name`, `signature`, `signature_hash`, `parent_qualified_name` columns added in v24 (Phase 105, TS/TSX/JS/Python only) |
| `symbol_embeddings` | Per-symbol embedding |
| `commit_embeddings` | Per-commit summary embedding |
| `blob_clusters` | K-means cluster assignments |
| `cluster_assignments` | Cluster snapshot entries per ref |
| `module_embeddings` | Directory centroid running-mean embeddings (Phase 33) |
| `embed_config` | Recorded embedding provenance (model, dimensions, chunker); also stores narrator/guide LLM model configs via `kind` + `params_json` (v22) |
| `indexing_checkpoints` | Resume markers for interrupted indexing runs |
| `settings` | Key-value settings, e.g. active narrator/guide model config selection (v22) |
| `structural_refs` | Raw, unresolved structural references (imports/calls/extends/implements) per blob, dedup'd by `blob_hash`; added in v25 (Phase 106, knowledge-graph §3.2), populated by `index --graph` for TS/TSX/JS/Python only |
| `graph_nodes` | Structural graph nodes (`file:<path>`, `symbol:<path>#<qname>#<sighash>`, `external:<name>`); added in v26 (Phase 107, knowledge-graph §3.3), truncate-and-rebuilt by `gitsema graph build` |
| `edges` | Typed edges between graph nodes (contains/defines/imports/calls/extends/implements/references/co_change); added in v26 (Phase 107, knowledge-graph §3.3), truncate-and-rebuilt by `gitsema graph build` |

**FTS5 note:** Blobs indexed before Phase 11 have no FTS5 content. `--hybrid` search only applies to blobs with FTS5 entries. `--include-content` in evolution dumps also depends on FTS5 content. Use `gitsema backfill-fts` to populate FTS5 content for older index entries.

**Schema migrations:** `sqlite.ts` runs versioned migrations on startup (idempotent):
- v0 → v1: Added `file_type` column to `embeddings` (Phase 8)
- v1 → v2: Added `blob_branches` table (Phase 15)
- v2 → v3: Added `query_embeddings` cache table (Phase 18)
- … (v3–v13: symbols, commit embeddings, clustering, module embeddings, provenance, HNSW quantization columns)
- v13 → v14: Added `repos` table for multi-repo registry (Phase 41)
- v14 → v17: Added `projections`, `saved_queries`, and related tables (Phases 53–55)
- v17 → v18: Added `repo_tokens` table for per-repo access control (Phase 75)
- v18 → v19: Added `embed_config` table for embedding provenance (Phase 80+)
- v19 → v20: Added `UNIQUE (blob_hash, path)` index on `paths` table (review6 §11.6 / Phase 89)
- v20 → v21: Hashed repo tokens at rest — `token_hash` + `token_prefix` replace plaintext `token` in `repo_tokens` (review7 §4.1)
- v21 → v22: Added `kind` + `params_json` columns to `embed_config`, and a `settings` key-value table, for LLM narrator/guide model configs (Phase 91)
- v22 → v23: Added `normalized_url`, `clone_path`, `last_indexed_at`, `ephemeral` columns to `repos` table for persistent server-side repo storage (`GITSEMA_DATA_DIR`)
- v23 → v24: Added `qualified_name`, `signature`, `signature_hash`, `parent_qualified_name` columns (+ indexes) to `symbols` table for path-free stable symbol identity (Phase 105 / knowledge-graph §3.1)
- v24 → v25: Added `structural_refs` table (+ indexes) for per-blob structural extraction — imports/calls/extends/implements sites (Phase 106 / knowledge-graph §3.2), populated by `index --graph`
- v25 → v26: Added `graph_nodes` and `edges` tables (+ indexes) for the structural linking pass (Phase 107 / knowledge-graph §3.3), truncate-and-rebuilt by `gitsema graph build`
- **Current version: 26**

Schema changes require updating both `src/core/db/schema.ts` and the migration logic in `src/core/db/sqlite.ts`.

---

## MCP integration

Start the server:
```bash
gitsema tools mcp
# or in dev:
node dist/cli/index.js tools mcp
```

**VS Code registration:** Developer Commands → `MCP: Add Server` → Command → `node /absolute/path/to/gitsema/dist/cli/index.js tools mcp`

The MCP server reads the same environment variables as the CLI. It runs against the `.gitsema/index.db` in the current working directory when the server is started.

**Exposed tools (38 total, registered across `src/mcp/tools/{search,analysis,clustering,infrastructure,workflow,narrator,graph}.ts`):**

| Tool | Description |
|---|---|
| `semantic_search` | Vector similarity search |
| `search_history` | Vector search with date filtering + optional chronological sort |
| `first_seen` | Find concept origin (sorted oldest-first) |
| `code_search` | Symbol-level semantic code search |
| `concept_evolution` | Concept drift timeline across the codebase |
| `evolution` | Single-file semantic drift timeline |
| `semantic_diff` | Semantic diff between two refs |
| `semantic_blame` | Per-block nearest-neighbor attribution |
| `index` | Trigger incremental re-indexing |
| `clusters` | K-means cluster snapshot |
| `cluster_diff` | Compare cluster snapshots at two refs |
| `cluster_timeline` | Multi-step cluster drift |
| `change_points` | Detect semantic change-point commits |
| `file_change_points` | Change points for a single file |
| `merge_audit` | Semantic collision detection before merge |
| `merge_preview` | Preview merge semantic impact |
| `branch_summary` | Branch semantic summary vs main |
| `author` | Author attribution for a concept |
| `impact` | Cross-module coupling analysis |
| `dead_concepts` | Find deleted semantic blobs |
| `security_scan` | Semantic vulnerability pattern scan (results are similarity scores, not confirmed CVEs) |
| `health_timeline` | Codebase health metrics by time bucket |
| `debt_score` | Technical debt scoring by isolation, age, and change frequency |
| `multi_repo_search` | Search across multiple registered gitsema repos |
| `experts` | Top contributors by semantic area (which concepts/clusters they work on) |
| `doc_gap` | Find code blobs with insufficient documentation coverage vs. prose/docs |
| `contributor_profile` | Top blobs an author specializes in (semantic centroid of their commits) |
| `ownership` | Ownership heatmap: ranks authors by share of touched blobs for a concept |
| `eval` | Retrieval evaluation harness — precision@k, recall@k, MRR for a JSONL test set |
| `triage` | Incident triage bundle: first-seen, change points, evolution, bisect, experts |
| `policy_check` | CI policy gate — debt score, security similarity, and concept drift thresholds |
| `workflow_run` | Run a named workflow template (`pr-review` \| `incident` \| `release-audit`) |
| `narrate_repo` | Generate evidence (default) or an LLM narrative of repository development history |
| `explain_issue_or_error` | Generate evidence (default) or an LLM explanation/timeline for a bug, error, or topic |
| `call_graph` | Structural call-graph traversal — callers/callees of a symbol (Phase 108) |
| `graph_neighbors` | Typed neighborhood of a graph node — any edge kinds, direction, depth (Phase 108) |
| `hotspots` | Architectural risk = co-change × call-coupling × churn; `lens` selects which signals (Phase 110) |
| `get_skill` | Return the gitsema agent skill (usage + result-interpretation guidance for every tool) — MCP-only, so clients can ground tool usage |

---

## Tool interpretations (single source of truth)

`src/core/narrator/interpretations.ts` is the single source of truth for **how to read
each tool's output** — result shape, what's significant, thresholds, and caveats. It
feeds three consumers:

1. The `gitsema guide` agentic system prompt (`buildGuideToolCatalog()` in `guide.ts`).
2. The `narrate`/`explain` and result-narration (`src/core/llm/narrator.ts`) system
   prompts (`buildNarratorSystemPrompt(name)`), replacing hardcoded persona strings.
3. The "Interpreting gitsema tool results" section of `skill/gitsema-ai-assistant.md`
   (and its `.github/skills/gitsema.md` mirror), generated by `pnpm gen:skill`. This
   block **joins** each interpretation with its **usage** guidance (the `description`
   + `parameters` from the `GUIDE_TOOLS` definition) so the skill shows both "how to
   use" and "how to read it" per tool.

Note the two-file split (see the `interpretations.ts` header): **how to use** a tool
(its `description` + `parameters`) lives with the executable `GUIDE_TOOLS` definitions
in `src/core/narrator/guideTools.ts` (and the MCP `registerTool` description); **how to
read** its result lives in `interpretations.ts`. They are kept separate so this registry
stays dependency-free for the narrators and the skill generator.

**When a tool's output shape changes:** update its entry in `interpretations.ts`, then
run `pnpm gen:skill` to regenerate the skill. The `docsSync` test enforces that every
`GUIDE_TOOLS` entry has a corresponding `TOOL_INTERPRETATIONS` entry and that the
generated skill block matches what's committed.

---

## Design constraints (non-negotiable)

1. **Git is the source of truth.** Never maintain state that Git already knows. All metadata (commit timestamps, file paths) comes from Git objects.
2. **Blob-first.** Every operation pivots on `blob_hash`, not file path or commit. A file renamed across commits is the same blob.
3. **Immutable embeddings.** A blob is embedded exactly once. Never recompute unless the user explicitly re-indexes with `--since all`.
4. **Streaming, not batch.** The Git walker must be streaming. Never buffer entire repo history in memory. Repos can have millions of blobs.
5. **CLI-first.** The MCP layer is a thin adapter over the CLI modules. It shares the same core logic and database. It does not duplicate business logic.

**Practical rules:**
- The deduplication check in `deduper.ts` is the most critical optimization — preserve it in all indexing paths.
- `p-limit` concurrency wraps all embedding calls. Default concurrency is 4 — don't remove this throttle.
- Search queries always use the text provider (not the code provider), since queries are natural language.
- Cosine similarity is computed in pure JS. This is fast enough for ~500K blobs; do not add a vector index unless scale demands it.
- Do not add new top-level CLI commands without updating `src/cli/index.ts`.

---

## Development conventions

- **ESM only.** `"type": "module"` in `package.json`. All imports must use `.js` extensions (even for `.ts` source files). No CommonJS. This is enforced by `module: Node16` in `tsconfig.json` (ESM-strict import resolution); Vitest resolves `.js` specifiers back to `.ts` files automatically.
- **Strict TypeScript.** `strict: true` in `tsconfig.json`. No `any` casts without explicit reason.
- **No barrel exports.** Import directly from the file that defines the function/class.
- **Test suite:** Vitest is used for tests (`pnpm test`). Tests live in `tests/` (unit) and `tests/integration/` (end-to-end). Add tests for any new core logic.
- **Logger:** Use `logger.ts` (`log.info`, `log.debug`, etc.) — do not use `console.log` in library code. `console.log` is acceptable in CLI command handlers for user output.
- **Error handling:** Errors from embedding providers should be caught per-blob and counted in stats (not crash the whole indexer). See `indexer.ts` for the pattern.
- **End of phase:** Do **not** run `npm version` or push `v*` tags manually. Instead, add a changeset (`pnpm exec changeset` or a `.changeset/<kebab-name>.md` file, `minor` for a new phase / feature, `patch` for hotfixes) describing the change — see "Releases & changesets" above. This is a required step — do not skip it. Versioning, tagging, and npm publishing are handled automatically by `changesets/action` on `main`.

---

## Known gaps & future phases

For the full list of gaps and planned work, see [`docs/PLAN.md`](docs/PLAN.md) and [`docs/features.md`](docs/features.md#planned--in-progress).

| Gap | Notes |
|---|---|
| **Python model server** | Docker image and Dockerfile provided to avoid local Rust/wheel issues on Windows; use Docker to run the modelserver. |
