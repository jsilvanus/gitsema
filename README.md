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
pnpm link --global   # puts `gitsema` on your PATH (optional)
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

### `gitsema status`

Show index statistics and database path.

```
gitsema status
```

---

### `gitsema index [options]`

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
```

Examples:

```bash
# Full index
gitsema index

# Only TypeScript files added since a tag
gitsema index --since v1.2.0 --ext ".ts,.tsx"

# Use function-level chunking with higher concurrency
gitsema index --chunker function --concurrency 8
```

---

### `gitsema search <query> [options]`

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

### `gitsema first-seen <query> [options]`

Find when a concept first appeared in the codebase, sorted chronologically.

```
Options:
  -k, --top <n>   Number of results (default: 10)
```

```bash
gitsema first-seen "JWT token validation"
```

---

### `gitsema evolution <path> [options]`

Track the semantic drift of a file across its Git history.

```
Options:
  --threshold <n>       Cosine distance above which a version change is flagged (default: 0.3)
  --dump [file]         Output structured JSON; writes to <file> or stdout if omitted
  --include-content     Include stored file content in the JSON dump (requires --dump)
```

```bash
gitsema evolution src/core/auth/middleware.ts
gitsema evolution src/core/auth/middleware.ts --dump evolution.json
```

---

### `gitsema concept-evolution <query> [options]`

Show how a semantic concept evolved across the commit history.

```
Options:
  -k, --top <n>         Number of top-matching blobs to include (default: 50)
  --threshold <n>       Cosine distance threshold for flagging large changes (default: 0.3)
  --dump [file]         Output structured JSON
  --include-content     Include stored file content in the JSON dump (requires --dump)
```

```bash
gitsema concept-evolution "authentication"
```

---

### `gitsema diff <ref1> <ref2> <path>`

Compute the semantic diff between two versions of a file.

```
Options:
  --neighbors <n>   Number of nearest-neighbour blobs to show for each version (default: 0)
```

```bash
gitsema diff HEAD~10 HEAD src/api/router.ts
```

---

### `gitsema mcp`

Start the gitsema MCP server over stdio. Allows AI assistants to query the semantic index via the Model Context Protocol.

```bash
gitsema mcp
```

## Data storage

The index is stored in `.gitsema/index.db` (SQLite) in the root of the repository. Add it to `.gitignore` to avoid committing it:

```
.gitsema/
```
