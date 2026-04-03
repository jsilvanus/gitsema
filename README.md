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

Commands are organised into five groups:

| Group | Commands |
|---|---|
| **Setup & Infrastructure** | `status`, `index`, `serve`, `remote-index`, `backfill-fts`, `mcp` |
| **Search & Discovery** | `search`, `first-seen`, `dead-concepts` |
| **File History** | `file-evolution`, `file-diff`, `blame`, `impact` |
| **Concept History** | `concept-evolution` |
| **Cluster Analysis** | `clusters`, `cluster-diff`, `cluster-timeline` |

> **Backward-compatible renames (v1 aliases):** `evolution` → `file-evolution`, `diff` → `file-diff`, `semantic-blame` → `blame`. The old names still work and are shown alongside new names in `--help`.

---

### Setup & Infrastructure

#### `gitsema status`

Show index statistics and database path.

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
  --concurrency <n>       Number of blobs to embed concurrently (default: 4).
  --ext <extensions>      Only index files with these extensions, e.g. ".ts,.js,.py"
  --max-size <size>       Skip blobs larger than this size, e.g. "200kb", "1mb" (default: 200kb)
  --exclude <patterns>    Skip blobs whose path contains any of these patterns, e.g. "node_modules,dist"
  --chunker <strategy>    Chunking strategy: file (default), function, or fixed
  --window-size <n>       Chunk size in characters for the fixed chunker (default: 1500)
  --overlap <n>           Overlap between adjacent fixed chunks (default: 200)
  --file <paths...>       Index specific file(s) from HEAD (can supply multiple paths)
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

#### `gitsema serve [options]`

Start the gitsema HTTP API server so remote machines can delegate embedding and storage to a central host.

```
Options:
  --port <n>      Port to listen on (default: 4242)
  --key <token>   Require this Bearer token on all requests
  --chunker       Chunking strategy for incoming blobs: file (default), function, fixed
  --concurrency   Max concurrent embedding calls (default: 4)
```

---

#### `gitsema remote-index <repoUrl>`

Ask a remote `gitsema serve` instance to clone and index a Git repository.

---

#### `gitsema backfill-fts`

Populate FTS5 content for blobs indexed before Phase 11. Required to use `--hybrid` search on older index entries.

---

#### `gitsema mcp`

Start the gitsema MCP server over stdio. Allows AI assistants (Claude, VS Code Copilot, etc.) to query the semantic index via the Model Context Protocol.

```bash
gitsema mcp
```

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

*See also: [`search`](#gitsema-search-query-options), [`concept-evolution`](#gitsema-concept-evolution-query-options)*

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

*See also: [`search`](#gitsema-search-query-options), [`concept-evolution`](#gitsema-concept-evolution-query-options)*

```
Options:
  -k, --top <n>       Number of results (default: 10)
  --since <date>      Only consider blobs whose latest commit is on or after this date
  --dump [file]       Output structured JSON
```

---

### File History

#### `gitsema file-evolution <path> [options]`

> **Alias:** `gitsema evolution` (backward-compatible)

Track the semantic drift of a file across its Git history.

*See also: [`file-diff`](#gitsema-file-diff-ref1-ref2-path), [`concept-evolution`](#gitsema-concept-evolution-query-options)*

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

> **Alias:** `gitsema diff` (backward-compatible)

Compute the semantic diff between two versions of a file.

*See also: [`file-evolution`](#gitsema-file-evolution-path-options), [`cluster-diff`](#gitsema-cluster-diff-ref1-ref2)*

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

#### `gitsema concept-evolution <query> [options]`

Show how a semantic concept evolved across the entire commit history.

*See also: [`file-evolution`](#gitsema-file-evolution-path-options), [`first-seen`](#gitsema-first-seen-query-options)*

```
Options:
  -k, --top <n>         Number of top-matching blobs to include (default: 50)
  --threshold <n>       Cosine distance threshold for flagging large changes (default: 0.3)
  --dump [file]         Output structured JSON
  --html [file]         Output an interactive HTML visualization
  --include-content     Include stored file content in the JSON dump (requires --dump)
```

```bash
gitsema concept-evolution "authentication"
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

## Data storage

The index is stored in `.gitsema/index.db` (SQLite) in the root of the repository. Add it to `.gitignore` to avoid committing it:

```
.gitsema/
```
