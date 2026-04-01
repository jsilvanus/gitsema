# gitsema — CLAUDE.md

## Project overview

`gitsema` is a **content-addressed semantic index synchronized with Git's object model**. It walks a repository's full history, embeds every unique blob (file snapshot) exactly once, and enables semantic search across time. The unit of identity is the blob SHA-1 hash — not the file path, not the commit. Identical content is deduplicated automatically regardless of how many commits reference it.

**Core capabilities:**
- Semantic search over all of Git history (not just HEAD)
- Temporal analysis: `first-seen`, `evolution`, `concept-evolution`
- Hybrid search (vector similarity + BM25 keyword matching)
- Multiple chunking strategies (whole-file, function boundaries, fixed windows)
- Multi-model routing (separate models for code vs. prose)
- MCP server exposing all capabilities to Claude and other AI clients

---

## Build & run

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

**Version:**
```bash
gitsema -V   # reads version from package.json at runtime
```

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

The indexer applies a multi-level fallback chain: whole-file → function chunker → fixed windows (1500 chars → 800 chars) when a blob exceeds the embedding model's context limit.

### `gitsema search <query> [options]`

| Flag | Default | Description |
|---|---|---|
| `-k, --top <n>` | `10` | Results to return |
| `--recent` | off | Blend cosine similarity with recency score |
| `--alpha <n>` | `0.8` | Cosine weight in blended score |
| `--before <date>` | — | Only blobs first seen before YYYY-MM-DD |
| `--after <date>` | — | Only blobs first seen after YYYY-MM-DD |
| `--weight-vector <n>` | `0.7` | Vector weight in three-signal ranking |
| `--weight-recency <n>` | `0.2` | Recency weight |
| `--weight-path <n>` | `0.1` | Path-relevance weight |
| `--group <mode>` | — | Collapse results by `file` \| `module` \| `commit` |
| `--chunks` | off | Include chunk-level embeddings |
| `--hybrid` | off | Combine vector + BM25 (FTS5) |
| `--bm25-weight <n>` | `0.3` | BM25 weight in hybrid score |
| `--branch <name>` | — | Restrict results to blobs seen on this branch |

### `gitsema first-seen <query> [-k n]`
Find when a concept first appeared — same as `search` but sorted chronologically (earliest first).

### `gitsema evolution <path> [options]`
Track semantic drift of a single file across its Git history.

| Flag | Default | Description |
|---|---|---|
| `--threshold <n>` | `0.3` | Cosine distance above which a version is flagged as a large change |
| `--dump [file]` | — | Output structured JSON; writes to `<file>` or stdout |
| `--include-content` | off | Add stored file text per version in JSON (requires `--dump`) |
| `--branch <name>` | — | Restrict evolution to blobs seen on this branch |

### `gitsema concept-evolution <query> [options]`
Trace how a semantic concept evolved across the entire codebase history.

| Flag | Default | Description |
|---|---|---|
| `-k, --top <n>` | `50` | Top-matching blobs to include |
| `--threshold <n>` | `0.3` | Large-change flag threshold |
| `--dump [file]` | — | Structured JSON output |
| `--include-content` | off | Add stored file text (requires `--dump`) |

### `gitsema diff <ref1> <ref2> <path>`
Compute cosine distance between two versions of a file. `--neighbors <n>` shows nearest-neighbor blobs for each version.

### `gitsema serve [options]`
Start an HTTP API server that exposes embedding and storage over the network. Allows remote machines to delegate indexing to a central server.

| Flag | Default | Description |
|---|---|---|
| `--port <n>` | `4242` | Port to listen on (also `GITSEMA_SERVE_PORT`) |
| `--key <token>` | — | Require Bearer token on all requests (also `GITSEMA_SERVE_KEY`) |

### `gitsema backfill-fts`
Populate FTS5 content for blobs indexed before Phase 11 (when FTS5 support was added). Required to use `--hybrid` search on older index entries.

### `gitsema mcp`
Start the MCP server over stdio. Exposes: `semantic_search`, `search_history`, `first_seen`, `evolution`, `concept_evolution`, `index`.

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
[ src/core/search/ ]       vectorSearch.ts  — cosine similarity, three-signal ranking
   │                        hybridSearch.ts  — vector + BM25 fusion
   │                        evolution.ts     — file/concept drift timelines
   │                        timeSearch.ts    — date parsing, recency scoring
   │                        ranking.ts       — result formatting and grouping
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

All configuration is via environment variables. No config file.

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
| `GITSEMA_SERVE_PORT` | `4242` | Port for `gitsema serve` HTTP server |
| `GITSEMA_SERVE_KEY` | *(optional)* | Bearer token required by `gitsema serve` |

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

- **Location:** `.gitsema/index.db` (relative to the indexed repo root)
- **Engine:** SQLite via `better-sqlite3`, WAL mode enabled
- **ORM:** Drizzle ORM (`src/core/db/schema.ts`)
- **Add to `.gitignore`:** `.gitsema/`

**Schema overview:**

| Table | Purpose |
|---|---|
| `blobs` | Blob registry (hash, size, indexed_at) |
| `embeddings` | Whole-file embedding per blob (Float32 bytes, model name) |
| `chunks` | Sub-file fragments (start/end line, blob FK) |
| `chunk_embeddings` | Per-chunk embedding |
| `paths` | blob_hash → file path (one blob can map to many paths) |
| `commits` | Commit hash, timestamp, first-line message |
| `blob_commits` | Many-to-many blob ↔ commit join |
| `indexed_commits` | Tracks which commits have been fully processed (incremental resume) |
| `blob_fts` | FTS5 virtual table for BM25 hybrid search |
| `blob_branches` | Maps blobs to branch names (added in Phase 15) |

**FTS5 note:** Blobs indexed before Phase 11 have no FTS5 content. `--hybrid` search only applies to blobs with FTS5 entries. `--include-content` in evolution dumps also depends on FTS5 content. Use `gitsema backfill-fts` to populate FTS5 content for older index entries.

**Schema migrations:** `sqlite.ts` runs versioned migrations on startup (idempotent):
- v0 → v1: Added `file_type` column to `embeddings` (Phase 8)
- v1 → v2: Added `blob_branches` table (Phase 15)

Schema changes require updating both `src/core/db/schema.ts` and the migration logic in `src/core/db/sqlite.ts`.

---

## MCP integration

Start the server:
```bash
gitsema mcp
# or in dev:
node dist/cli/index.js mcp
```

**VS Code registration:** Developer Commands → `MCP: Add Server` → Command → `node /absolute/path/to/gitsema/dist/cli/index.js mcp`

The MCP server reads the same environment variables as the CLI. It runs against the `.gitsema/index.db` in the current working directory when the server is started.

**Exposed tools:**

| Tool | Description |
|---|---|
| `semantic_search` | Vector similarity search |
| `search_history` | Vector search with date filtering + optional chronological sort |
| `first_seen` | Find concept origin (sorted oldest-first) |
| `evolution` | File semantic drift timeline (human-readable or structured JSON) |
| `concept_evolution` | Cross-codebase concept drift timeline |
| `index` | Trigger incremental re-indexing |

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

- **ESM only.** `"type": "module"` in `package.json`. All imports must use `.js` extensions (even for `.ts` source files). No CommonJS.
- **Strict TypeScript.** `strict: true` in `tsconfig.json`. No `any` casts without explicit reason.
- **No barrel exports.** Import directly from the file that defines the function/class.
- **No test suite yet.** Vitest is installed and `vitest.config.ts` exists, but no tests are written. Tests are a known gap.
- **Logger:** Use `logger.ts` (`log.info`, `log.debug`, etc.) — do not use `console.log` in library code. `console.log` is acceptable in CLI command handlers for user output.
- **Error handling:** Errors from embedding providers should be caught per-blob and counted in stats (not crash the whole indexer). See `indexer.ts` for the pattern.

---

## Known gaps & future phases

| Gap | Notes |
|---|---|
| **No test suite** | Highest priority technical debt. `vitest.config.ts` exists and Vitest is installed, but no tests are written. Need integration tests (indexer + search) and unit tests (chunking, ranking). |
| **Phase 13: Python model server** | `modelserver/` is scaffolded (FastAPI + sentence-transformers) but blocked on Windows — `tokenizers` requires a Rust toolchain. A Docker image would solve this. |
| **Cosine at scale** | Pure-JS cosine works to ~500K blobs. `sqlite-vss` or DuckDB migration path is in the risk register but not designed. |
