# gitsema

A content-addressed semantic index synchronized with Git's object model.

Gitsema walks your Git history, embeds every blob, and lets you semantically search your codebase — including across time. It treats blob hashes as the unit of identity, so identical content is only embedded once regardless of how many commits reference it.

## Requirements

- Node.js 18+
- Git (must be on `PATH`)
- An embedding backend — either:
  - **Ollama** (local, default): [ollama.ai](https://ollama.ai) with `nomic-embed-text` pulled
  - **HTTP / OpenAI-compatible API**: any endpoint that speaks the OpenAI embeddings API

## Installation

```bash
git clone https://github.com/jsilvanus/gitsema.git
cd gitsema
pnpm install
pnpm build           # compiles TypeScript → dist/

# Optional: put `gitsema` on your PATH
pnpm setup           # one-time setup; then open a new terminal
pnpm link --global
```

To use without linking, prefix commands with `node dist/cli/index.js` instead of `gitsema`.

## Quick start

```bash
cd /path/to/your/git/repo

# 1. Index all blobs (uses Ollama by default)
gitsema index

# 2. Search
gitsema search "authentication middleware"

# 3. Check index status
gitsema status
```

## Configuration (environment variables)

All configuration is done through environment variables. Set them in your shell or in a `.env` file loaded before running `gitsema`.

### Provider selection

| Variable | Default | Description |
|---|---|---|
| `GITSEMA_PROVIDER` | `ollama` | Embedding backend: `ollama` or `http` |

### Ollama provider (`GITSEMA_PROVIDER=ollama`)

| Variable | Default | Description |
|---|---|---|
| `GITSEMA_MODEL` | `nomic-embed-text` | Ollama model to use for embeddings |
| `GITSEMA_TEXT_MODEL` | value of `GITSEMA_MODEL` | Model used for text/prose files |
| `GITSEMA_CODE_MODEL` | value of `GITSEMA_TEXT_MODEL` | Model used for source code files (overrides text model) |

Ollama is assumed to be running at `http://localhost:11434`. Pull the model first:

```bash
ollama pull nomic-embed-text
```

### HTTP / OpenAI-compatible provider (`GITSEMA_PROVIDER=http`)

| Variable | Default | Description |
|---|---|---|
| `GITSEMA_HTTP_URL` | *(required)* | Base URL of the embeddings API, e.g. `https://api.openai.com` |
| `GITSEMA_MODEL` | `nomic-embed-text` | Model name passed in the request body |
| `GITSEMA_TEXT_MODEL` | value of `GITSEMA_MODEL` | Model for text files |
| `GITSEMA_CODE_MODEL` | value of `GITSEMA_TEXT_MODEL` | Model for code files |
| `GITSEMA_API_KEY` | *(optional)* | Bearer token sent as `Authorization: Bearer <key>` |

Example for OpenAI:

```bash
export GITSEMA_PROVIDER=http
export GITSEMA_HTTP_URL=https://api.openai.com
export GITSEMA_MODEL=text-embedding-3-small
export GITSEMA_API_KEY=sk-...
gitsema index
```

## Commands

Commands are organised into groups. See [`features.md`](features.md) for the full feature catalog.

| Group | Commands |
|---|---|
| **Indexing** | `index` (+ `export`/`import` subcommands), `status`, `remote-index`, `update-modules`, `watch` |
| **Protocol Servers** | `tools mcp`, `tools serve`, `tools lsp` |
| **Search & Discovery** | `search`, `code-search`, `first-seen`, `dead-concepts` |
| **File History** | `file-evolution`, `file-diff`, `blame`, `impact` |
| **Concept History** | `evolution`, `diff`, `lifecycle`, `bisect` |
| **Cluster Analysis** | `clusters`, `cluster-diff`, `cluster-timeline` |
| **Change Detection** | `change-points`, `file-change-points`, `cluster-change-points` |
| **Branch / Merge** | `branch-summary`, `merge-audit`, `merge-preview`, `cherry-pick-suggest`, `ci-diff` |
| **Analysis** | `author`, `impact`, `refactor-candidates`, `doc-gap`, `contributor-profile`, `security-scan`, `health`, `debt` |
| **Visualization** | `map`, `heatmap` |
| **DB Maintenance** | `doctor`, `vacuum`, `rebuild-fts`, `backfill-fts`, `gc`, `build-vss`, `clear-model` |
| **Configuration** | `config`, `repos`, `project` |

> **Backward-compatible aliases:** `concept-evolution` → `evolution`, `semantic-blame` → `blame`, `gitsema mcp` / `gitsema serve` / `gitsema lsp` → use `gitsema tools mcp` / `gitsema tools serve` / `gitsema tools lsp` instead (old names still work but emit a deprecation notice).

---

### Setup & Infrastructure

#### `gitsema status`

Show index statistics and database path. Also displays embed config provenance (provider, model, dimensions, chunker) recorded from previous index runs.

```
gitsema status
```

---

#### `gitsema index [options]`

Walk the Git history and embed all blobs into the index. Already-indexed blobs are skipped automatically (content-addressed deduplication).

```
Options:
  --since <ref>           Only index commits after this point.
                          Accepts a date (2024-01-01), tag (v1.0), or commit hash.
                          Use "all" to force a full re-index.
  --max-commits <n>       Stop after indexing this many commits.
  --concurrency <n>       Number of blobs to embed concurrently in parallel (default: 4).
                          Increase on fast hardware / remote APIs; decrease if the embedding
                          server is being throttled.
  --ext <extensions>      Only index files with these extensions, e.g. ".ts,.js,.py"
  --max-size <size>       Skip blobs larger than this size, e.g. "200kb", "1mb" (default: 200kb)
  --exclude <patterns>    Skip blobs whose path contains any of these patterns, e.g. "node_modules,dist"
  --chunker <strategy>    Chunking strategy: file (default), function, or fixed
  --window-size <n>       Chunk size in characters for the fixed chunker (default: 1500)
  --overlap <n>           Overlap between adjacent fixed chunks (default: 200)
  --file <paths...>       Index specific file(s) from HEAD (can supply multiple paths)
  --allow-mixed           Skip embed-config compatibility check (allow mixing different
                          embedding dimensions/configs in the same index)
```

Examples:

```bash
# Full index
gitsema index

# Only TypeScript files added since a tag
gitsema index --since v1.2.0 --ext ".ts,.tsx"

# Use function-level chunking with higher concurrency
gitsema index --chunker function --concurrency 8

# Index specific files from HEAD
gitsema index --file docs/PLAN.md src/cli/commands/index.ts --concurrency 2
```

---

#### `gitsema remote-index <repoUrl>`

Ask a remote `gitsema tools serve` instance to clone and index a Git repository.

---

#### `gitsema backfill-fts`

Populate FTS5 content for blobs indexed before Phase 11. Required to use `--hybrid` search on older index entries.

---

#### `gitsema doctor`

Run integrity checks and report the health of the index database.

```bash
gitsema doctor
```

Checks performed:
- Schema version vs expected version
- Blob / embedding / FTS row counts
- Missing FTS rows (suggests `backfill-fts`)
- Orphan embeddings (suggests `gc`)
- SQLite integrity check (`PRAGMA integrity_check`)
- Stored embed config provenance (provider, model, dimensions, chunker)

Exits with code 1 if critical issues (integrity failures or schema mismatch) are detected.

---

#### `gitsema vacuum`

Run `VACUUM` and `ANALYZE` on the SQLite index database. Compacts the file and refreshes query planner statistics. Safe to run at any time.

```bash
gitsema vacuum
```

---

#### `gitsema rebuild-fts`

Rebuild the FTS5 full-text search index from stored data. Use after bulk deletions or if hybrid search returns stale results.

```bash
gitsema rebuild-fts        # prompts for confirmation
gitsema rebuild-fts --yes  # skip confirmation
```

---

#### `gitsema tools mcp`

Start the gitsema MCP server over stdio. Allows AI assistants (Claude, VS Code Copilot, etc.) to query the semantic index via the Model Context Protocol.

```bash
gitsema tools mcp
```

> **Alias:** `gitsema mcp` still works but is deprecated. Use `gitsema tools mcp`.

#### `gitsema tools lsp [--tcp <port>]`

Start the LSP semantic hover server. Responds to hover requests with nearest-neighbor blobs.

```bash
gitsema tools lsp          # stdio (default)
gitsema tools lsp --tcp 7777
```

#### `gitsema tools serve [options]`

Start the gitsema HTTP API server so remote machines can delegate embedding and storage to a central host. Replaces the deprecated top-level `gitsema serve` command.

```
Options:
  --port <n>      Port to listen on (default: 4242)
  --key <token>   Require this Bearer token on all requests
  --ui            Serve the embedded 2D codebase map web UI at /ui
```

> **Alias:** `gitsema serve` still works but is deprecated. Use `gitsema tools serve`.

---

### Search & Discovery

#### `gitsema search <query> [options]`

Semantically search the index.

```
Options:
  -k, --top <n>           Number of results (default: 10)
  --recent                Blend cosine similarity with a recency score
  --alpha <n>             Weight for cosine similarity in blended score (0–1, default: 0.8)
  --before <date>         Only blobs first seen before this date (YYYY-MM-DD)
  --after <date>          Only blobs first seen after this date (YYYY-MM-DD)
  --weight-vector <n>     Weight for vector similarity in three-signal ranking (default: 0.7)
  --weight-recency <n>    Weight for recency (default: 0.2)
  --weight-path <n>       Weight for path relevance (default: 0.1)
  --group <mode>          Group results by: file, module, or commit
  --chunks                Include chunk-level embeddings in results
  --hybrid                Combine vector similarity with BM25 keyword matching
  --bm25-weight <n>       Weight for the BM25 signal in hybrid search (default: 0.3)
```

Examples:

```bash
gitsema search "authentication middleware"
gitsema search "database connection pool" --top 20
gitsema search "rate limiting" --recent --after 2024-01-01
gitsema search "error handling" --hybrid
```

---

#### `gitsema first-seen <query> [options]`

Find when a concept first appeared in the codebase, sorted chronologically.

*See also: [`search`](#gitsema-search-query-options), [`evolution`](#gitsema-evolution-query-options)*

```
Options:
  -k, --top <n>   Number of results (default: 10)
```

```bash
gitsema first-seen "JWT token validation"
```

---

#### `gitsema dead-concepts [options]`

Find historical concepts that no longer exist in HEAD but are semantically similar to current code.

*See also: [`search`](#gitsema-search-query-options), [`evolution`](#gitsema-evolution-query-options)*

```
Options:
  -k, --top <n>       Number of results (default: 10)
  --since <date>      Only consider blobs whose latest commit is on or after this date
  --dump [file]       Output structured JSON
```

---

### File History

#### `gitsema file-evolution <path> [options]`

Track the semantic drift of a file across its Git history.

*See also: [`file-diff`](#gitsema-file-diff-ref1-ref2-path), [`evolution`](#gitsema-evolution-query-options)*

```
Options:
  --threshold <n>       Cosine distance above which a version change is flagged (default: 0.3)
  --dump [file]         Output structured JSON; writes to <file> or stdout if omitted
  --include-content     Include stored file content in the JSON dump (requires --dump)
  --alerts [n]          Show the top-N largest semantic jumps (default: 5)
```

```bash
gitsema file-evolution src/core/auth/middleware.ts
gitsema file-evolution src/core/auth/middleware.ts --dump evolution.json
```

---

#### `gitsema file-diff <ref1> <ref2> <path>`

Compute the semantic diff between two versions of a file.

*See also: [`file-evolution`](#gitsema-file-evolution-path-options), [`cluster-diff`](#gitsema-cluster-diff-ref1-ref2), [`diff`](#gitsema-diff-ref1-ref2)*

```
Options:
  --neighbors <n>   Number of nearest-neighbour blobs to show for each version (default: 0)
```

```bash
gitsema file-diff HEAD~10 HEAD src/api/router.ts
```

---

#### `gitsema blame <file> [options]`

> **Alias:** `gitsema semantic-blame` (backward-compatible)

Show the semantic origin of each logical block in a file — nearest-neighbour blame.

*See also: [`file-evolution`](#gitsema-file-evolution-path-options), [`impact`](#gitsema-impact-path-options)*

```
Options:
  -k, --top <n>   Number of nearest-neighbor blobs to show per block (default: 3)
  --dump [file]   Output structured JSON
```

---

#### `gitsema impact <path> [options]`

Compute semantically similar blobs across the codebase to highlight refactor impact.

*See also: [`blame`](#gitsema-blame-file-options), [`file-diff`](#gitsema-file-diff-ref1-ref2-path)*

```
Options:
  -k, --top <n>   Number of similar blobs to return (default: 10)
  --chunks        Include chunk-level embeddings for finer-grained coupling
  --dump [file]   Output structured JSON
```

---

### Concept History

#### `gitsema evolution <query> [options]`

> **Alias:** `gitsema concept-evolution` (backward-compatible)

Show how a semantic concept evolved across the entire commit history.

*See also: [`file-evolution`](#gitsema-file-evolution-path-options), [`first-seen`](#gitsema-first-seen-query-options), [`diff`](#gitsema-diff-ref1-ref2)*

```
Options:
  -k, --top <n>         Number of top-matching blobs to include (default: 50)
  --threshold <n>       Cosine distance threshold for flagging large changes (default: 0.3)
  --dump [file]         Output structured JSON
  --html [file]         Output an interactive HTML visualization
  --include-content     Include stored file content in the JSON dump (requires --dump)
```

```bash
gitsema evolution "authentication"
gitsema concept-evolution "authentication"   # backward-compatible alias
```

---

#### `gitsema diff <ref1> <ref2> <query> [options]`

Compute a **conceptual/semantic diff** of a topic across two git refs.  Shows which
blobs matching the topic were **gained** (new in ref2), **lost** (removed from ref1),
and **stable** (present in both), each ranked by topic relevance — most relevant files
for the topic appear at the top of each group.

*See also: [`evolution`](#gitsema-evolution-query-options), [`file-diff`](#gitsema-file-diff-ref1-ref2-path), [`cluster-diff`](#gitsema-cluster-diff-ref1-ref2)*

```
Arguments:
  query             Topic or concept to compare across the two refs

Options:
  -k, --top <n>     Max results per group (gained/lost/stable) (default: 10)
  --dump [file]     Output structured JSON
```

```bash
gitsema diff v1.0.0 HEAD "authentication"
gitsema diff 2024-01-01 2024-06-01 "error handling" --top 5
gitsema diff HEAD~20 HEAD "database access" --dump diff.json
```

---

### Cluster Analysis

#### `gitsema clusters [options]`

Cluster all blob embeddings into semantic regions using k-means++ and display a concept graph.

*See also: [`cluster-diff`](#gitsema-cluster-diff-ref1-ref2), [`cluster-timeline`](#gitsema-cluster-timeline)*

```
Options:
  --k <n>                 Number of clusters (default: 8)
  --top <n>               Top representative paths per cluster (default: 5)
  --iterations <n>        Max k-means iterations (default: 20)
  --edge-threshold <n>    Cosine similarity threshold for concept graph edges (default: 0.3)
  --dump [file]           Output structured JSON
  --html [file]           Output an interactive HTML visualization
  --enhanced-labels       Enhance cluster labels using TF-IDF path and identifier analysis
```

---

#### `gitsema cluster-diff <ref1> <ref2>`

Compare semantic clusters between two points in history (temporal clustering).

*See also: [`clusters`](#gitsema-clusters-options), [`cluster-timeline`](#gitsema-cluster-timeline), [`file-diff`](#gitsema-file-diff-ref1-ref2-path)*

```bash
gitsema cluster-diff v1.0.0 HEAD
gitsema cluster-diff 2024-01-01 2024-06-01
```

---

#### `gitsema cluster-timeline`

Show how semantic clusters shifted over the commit history — multi-step timeline.

*See also: [`clusters`](#gitsema-clusters-options), [`cluster-diff`](#gitsema-cluster-diff-ref1-ref2)*

```
Options:
  --k <n>         Number of clusters per step (default: 8)
  --steps <n>     Number of evenly-spaced time checkpoints (default: 5)
  --since <ref>   Start date or git ref for the timeline
  --until <ref>   End date or git ref for the timeline
  --html [file]   Output an interactive HTML visualization
```

---

### Change Detection

#### `gitsema change-points <query> [options]`

Detect conceptual change points for a semantic query across the entire commit history.
For each indexed commit the command builds a weighted centroid from the top-k matching blobs
visible at that point in time and reports commits where the centroid shifted sharply.

*See also: [`concept-evolution`](#gitsema-concept-evolution-query-options), [`cluster-change-points`](#gitsema-cluster-change-points-options)*

```
Options:
  -k, --top <n>       Top-k blobs used to define concept state per commit (default: 50)
  --threshold <n>     Cosine distance threshold to flag a change point (default: 0.3)
  --top-points <n>    Show top-N largest jumps (default: 5)
  --since <ref>       Limit commits from this point; accepts date (YYYY-MM-DD), tag, or hash
  --until <ref>       Limit commits up to this point; accepts date (YYYY-MM-DD), tag, or hash
  --dump [file]       Output structured JSON; writes to <file> or stdout if omitted
```

```bash
gitsema change-points "authentication middleware"
gitsema change-points "database connection" --threshold 0.4 --top-points 3
gitsema change-points "error handling" --since 2024-01-01 --dump changes.json
```

Example JSON output (`--dump`):
```json
{
  "type": "concept-change-points",
  "query": "authentication middleware",
  "k": 50,
  "threshold": 0.3,
  "range": { "since": null, "until": null },
  "points": [
    {
      "before": { "commit": "a1b2c3d", "date": "2023-06-15", "timestamp": 1686787200, "topPaths": ["src/auth/session.ts"] },
      "after":  { "commit": "e4f5a6b", "date": "2023-09-20", "timestamp": 1695168000, "topPaths": ["src/auth/jwt.ts"] },
      "distance": 0.412
    }
  ]
}
```

---

#### `gitsema file-change-points <path> [options]`

Detect semantic change points in a single file's Git history.
Reports commits where the embedding distance between consecutive file versions exceeded the threshold.

*See also: [`file-evolution`](#gitsema-file-evolution-path-options), [`change-points`](#gitsema-change-points-query-options)*

```
Options:
  --threshold <n>     Cosine distance threshold (default: 0.3)
  --top-points <n>    Show top-N largest jumps (default: 5)
  --since <ref>       Limit commits from this point; accepts date (YYYY-MM-DD), tag, or hash
  --until <ref>       Limit commits up to this point; accepts date (YYYY-MM-DD), tag, or hash
  --dump [file]       Output structured JSON; writes to <file> or stdout if omitted
```

```bash
gitsema file-change-points src/core/auth/middleware.ts
gitsema file-change-points src/api/router.ts --threshold 0.4 --top-points 3
gitsema file-change-points src/db/schema.ts --since v1.0 --dump schema-changes.json
```

Example JSON output (`--dump`):
```json
{
  "type": "file-change-points",
  "path": "src/core/auth/middleware.ts",
  "threshold": 0.3,
  "range": { "since": null, "until": null },
  "points": [
    {
      "before": { "commit": "a1b2c3d", "date": "2023-06-15", "timestamp": 1686787200, "blobHash": "abc1234..." },
      "after":  { "commit": "e4f5a6b", "date": "2023-09-20", "timestamp": 1695168000, "blobHash": "def5678..." },
      "distance": 0.524
    }
  ]
}
```

---

#### `gitsema cluster-change-points [options]`

Detect change points in the repo's cluster structure across commit history.
For each sampled commit the command runs k-means clustering over visible blobs, matches clusters
between consecutive steps using greedy centroid similarity, and reports steps where the mean
centroid shift score exceeded the threshold.

*See also: [`cluster-timeline`](#gitsema-cluster-timeline), [`change-points`](#gitsema-change-points-query-options)*

> **Performance note:** By default every indexed commit is evaluated. On large repositories
> use `--max-commits` to cap the number of commits sampled (they are selected evenly across
> the since–until range).

```
Options:
  --k <n>             Number of clusters per step (default: 8)
  --threshold <n>     Mean centroid shift threshold (default: 0.3)
  --top-points <n>    Show top-N largest shifts (default: 5)
  --since <ref>       Limit commits from this point; accepts date (YYYY-MM-DD), tag, or hash
  --until <ref>       Limit commits up to this point; accepts date (YYYY-MM-DD), tag, or hash
  --max-commits <n>   Cap commits evaluated; sampled evenly (omit to evaluate every commit)
  --dump [file]       Output structured JSON; writes to <file> or stdout if omitted
```

```bash
gitsema cluster-change-points
gitsema cluster-change-points --k 6 --threshold 0.4 --top-points 3
gitsema cluster-change-points --max-commits 200 --dump cluster-changes.json
```

---

### Repo Insights

#### `gitsema experts [options]`

Rank contributors by the number of distinct blobs they introduced and show which semantic clusters/concepts they worked on. No embedding provider required — uses data already in the index.

> **Tip:** Run `gitsema clusters` first to populate cluster labels. Without clusters, semantic areas are shown as `cluster-<id>`.

*See also: [`author`](#gitsema-author-query-options), [`contributor-profile`](#gitsema-contributor-profile-author-options)*

```
Options:
  --top <n>           Number of top contributors to show (default: 10)
  --since <ref>       Only count commits at or after this date (YYYY-MM-DD or ISO 8601)
  --until <ref>       Only count commits at or before this date (YYYY-MM-DD or ISO 8601)
  --min-blobs <n>     Suppress contributors with fewer than this many blobs (default: 1)
  --top-clusters <n>  Max semantic areas to show per contributor (default: 5)
  --dump [file]       Output structured JSON; writes to <file> or stdout if omitted
  --html [file]       Output an interactive HTML report; writes to <file> or experts.html
```

```bash
# Top 10 contributors overall
gitsema experts

# Top 5 contributors since 2024, with JSON output
gitsema experts --top 5 --since 2024-01-01 --dump experts.json

# Interactive HTML report
gitsema experts --html experts.html
```

Example text output:
```
Top 3 contributors by semantic area (since 2024-01-01)

1. Alice <alice@example.com>
   Blobs: 142
   Semantic areas:
     · auth-module  [38 blobs]  (src/auth/jwt.ts, src/auth/session.ts)
     · api-routes   [31 blobs]  (src/routes/auth.ts)
     · db-layer     [12 blobs]  (src/db/users.ts)

2. Bob <bob@example.com>
   Blobs: 97
   Semantic areas:
     · db-layer     [44 blobs]  (src/db/schema.ts, src/db/migrations.ts)
     · tests        [29 blobs]  (tests/integration/db.test.ts)
```

---

#### `gitsema pr-report [options]`

Generates a **semantic PR report** combining semantic diff, impacted modules, change-point highlights, and reviewer suggestions. Designed for CI/bot ingestion.

| Flag | Default | Description |
|---|---|---|
| `--ref1 <ref>` | `HEAD~1` | Earlier git ref |
| `--ref2 <ref>` | `HEAD` | Later git ref |
| `--file <path>` | — | File to compute semantic diff and impact for |
| `--query <q>` | — | Topic query for change-point highlights |
| `-k, --top <n>` | `10` | Top-k results per section |
| `--since <date>` | — | Only include reviewer activity after this date |
| `--until <date>` | — | Only include reviewer activity before this date |
| `--dump [file]` | — | Output JSON to `<file>` or stdout if no file given |

```bash
gitsema pr-report --file src/auth.ts
gitsema pr-report --ref1 main --ref2 feature/auth --dump report.json
```

---

#### `gitsema eval <file> [options]`

**Retrieval evaluation harness** — measures search quality (P@k, R@k, MRR, latency) against a JSONL file of evaluation cases.

Each line of the JSONL file must be: `{ "query": "...", "expectedPaths": ["src/foo.ts"] }`

| Flag | Default | Description |
|---|---|---|
| `-k, --top <n>` | `10` | Top-k results per query |
| `--dump [file]` | — | Write full JSON results to `<file>` or stdout |

```bash
gitsema eval eval-cases.jsonl --top 10
gitsema eval eval-cases.jsonl --dump eval-results.json
```

---

### Search Performance & AI Reliability

#### `--early-cut <n>` (on `gitsema search`)

Limits the candidate pool to **n randomly-sampled blobs** before scoring. Useful for very large indexes (>100K blobs) to trade recall for speed.

```bash
gitsema search "authentication middleware" --early-cut 5000
```

#### `--explain-llm` (on `gitsema search`)

Outputs a **provenance citation block** for each result, formatted for injection into LLM prompts. Each block includes the file path, blob hash, first-seen date, score signals, and a content snippet.

```bash
gitsema search "authentication middleware" --explain-llm
```

#### `--profile <name>` (on `gitsema index`)

Applies a **preset indexing profile** that sets coherent defaults for concurrency, embed batch size, and chunker strategy.

| Profile | Concurrency | Batch size | Chunker | Best for |
|---|---|---|---|---|
| `speed` | 8 | 32 | file | Fast indexing on fast hardware |
| `balanced` | 4 | 16 | file | Default (auto-tuned) |
| `quality` | 2 | 4 | function | Deep chunk/symbol indexing |

```bash
gitsema index --profile speed
gitsema index --profile quality
```

#### `GET /api/v1/capabilities` (HTTP server)

Returns a machine-readable JSON manifest of all features supported by the running server, including version, provider models, and enabled features. Useful for client auto-configuration.

```bash
curl http://localhost:4242/api/v1/capabilities
```

---

## Automated Indexing (Git Hooks)

You can keep the semantic index in sync with your repository automatically by
installing the provided Git hook scripts.  Once installed, `gitsema index` runs
in the background after every `git commit` and every `git pull` / `git merge` —
no manual intervention required.

### How it works

| Hook | Trigger | Command run |
|---|---|---|
| `post-commit` | After every `git commit` | `gitsema index --since HEAD~1` |
| `post-merge` | After every `git pull` / `git merge` | `gitsema index --since ORIG_HEAD` |

Both hooks are safe no-ops when:
- `gitsema` is not on your `PATH`, or
- the index has not been initialised yet (run `gitsema index` once first).

### Installation (manual)

**Copy** the scripts into your repository's `.git/hooks/` directory and make
them executable:

```bash
cp scripts/hooks/post-commit  .git/hooks/post-commit
cp scripts/hooks/post-merge   .git/hooks/post-merge
chmod +x .git/hooks/post-commit .git/hooks/post-merge
```

**Alternatively**, use symlinks so the scripts stay in sync whenever you pull
updates to the `scripts/hooks/` directory:

```bash
ln -s ../../scripts/hooks/post-commit  .git/hooks/post-commit
ln -s ../../scripts/hooks/post-merge   .git/hooks/post-merge
```

### Toggle via `gitsema config`

The `gitsema config` command can install or remove the hooks automatically —
no manual file copying required:

```bash
# Install hooks for the current repository (symlinks into .git/hooks/)
gitsema config set hooks.enabled true

# Remove the managed hooks
gitsema config set hooks.enabled false
```

The config value is persisted in `.gitsema/config.json` so hooks are
re-enabled automatically when you run `gitsema config set hooks.enabled true`
again after a re-clone.  The manual copy/symlink steps above remain a valid
alternative if you prefer not to use the config command.

---

## Data storage

The index is stored in `.gitsema/index.db` (SQLite) in the root of the repository. Add it to `.gitignore` to avoid committing it:

```
.gitsema/
```

---

## Feature catalog

See [`features.md`](features.md) for the complete, grouped catalog of implemented features including indexing options, all search flags, history/temporal commands, clustering, branch/merge tools, the HTTP API route list, and all MCP tools.

---

## Strategic review

For the latest deep review of bottlenecks, missing features, productization ideas, and AI-assisted coding workflows, see [`docs/review4.md`](docs/review4.md).

---

## AI skill

A reusable AI-operator playbook is available at [`skill/gitsema-ai-assistant.md`](skill/gitsema-ai-assistant.md). Use it as a prompt scaffold for coding assistants that interact with `gitsema`.

---

## Roadmap / Plans

See [`docs/PLAN.md`](docs/PLAN.md) for the full development roadmap, phase history, and backlog of planned features.
