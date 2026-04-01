# gitsema — Refined Development Plan

> A Git-aware semantic search engine that treats code history as a time-indexed semantic dataset.

## Vision

`gitsema` is not just semantic search over Git. It is a content-addressed semantic index synchronized with Git's object model. Blob hashes are the unit of identity. Embeddings are immutable artifacts. The CLI is the primary interface.

---

## Guiding principles

- **Git is the source of truth.** Never maintain state that Git already knows.
- **Blob-first.** Every operation pivots on `blob_hash`, not file path or commit.
- **Immutable embeddings.** Computed once per blob, never recomputed.
- **One deliverable per phase.** Each phase ends with working, usable software.
- **CLI-first, MCP later.** The MCP layer wraps a mature tool, not a prototype.

---

## Architecture overview

```
git repo
   ↓
[ Git Walker ]          git rev-list --objects --all
   ↓                    git cat-file blob <hash>
[ Deduper ]             skip already-indexed blobs
   ↓
[ Embedding Engine ]    EmbeddingProvider interface
   ↓
[ SQLite + vectors ]    Drizzle ORM, blob-addressed schema
   ↓
[ CLI ]                 index · search · first-seen · evolution
   ↓ (phase 11)
[ MCP layer ]           semantic_search · search_history · first_seen
```

---

## Project structure

```
gitsema/
  src/
    cli/
      index.ts
      commands/
        index.ts
        search.ts
        firstSeen.ts
        evolution.ts
        status.ts

    core/
      git/
        revList.ts         -- git rev-list wrapper
        showBlob.ts        -- git cat-file blob wrapper
        commitMap.ts       -- commit → blob relationships

      indexing/
        indexer.ts
        blobStore.ts
        deduper.ts

      embedding/
        provider.ts        -- EmbeddingProvider interface
        local.ts           -- Ollama implementation
        http.ts            -- generic HTTP implementation

      search/
        vectorSearch.ts
        ranking.ts

      db/
        schema.ts
        sqlite.ts

      models/
        types.ts

    utils/
      logger.ts
      concurrency.ts

  package.json            -- ESM, type: "module"
  tsconfig.json
  README.md
```

---

## Phases

### Phase 1 — Foundation

**Goal:** Everything compiles, nothing runs yet.

Establish the project scaffold: ESM `package.json`, TypeScript config, directory
structure, and the canonical `types.ts`. Define core domain types up front so
later phases never need to negotiate their shapes:

```ts
type BlobHash   = string  // SHA-1 hex
type CommitHash = string
type Embedding  = number[]

interface BlobRecord {
  blobHash: BlobHash
  size: number
  indexedAt: number
}

interface SearchResult {
  blobHash: BlobHash
  paths: string[]
  score: number
  firstCommit?: CommitHash
  firstSeen?: number
}
```

Wire up the SQLite connection via Drizzle ORM. Define the minimal Phase 1 schema:

```ts
// blobs: known content
// embeddings: vector per blob
// paths: one row per (blob, path) pair — a blob may appear at many paths
```

**Deliverable:** `pnpm build` succeeds. Database opens. Schema is migrated.

---

### Phase 2 — Git walking

**Goal:** Stream all blobs from a repo without touching the embedding engine.

Implement the two Git primitives that underpin everything:

- `revList.ts` — wraps `git rev-list --objects --all`, parses blob hash + path
  pairs from stdout line by line as a Node.js `Readable` stream.
- `showBlob.ts` — wraps `git cat-file blob <hash>`, returns content as a
  `Buffer`. Apply a size cap here (default 200 KB) so it never becomes a problem
  later.

Build a `Walker` that composes these: iterates all blobs in the repo, yields
`{ blobHash, path, content }` objects. At this stage it just logs what it finds.

Key decision: the walker must be streaming, not batch. Large repos have hundreds
of thousands of blobs. Buffering them in memory before processing is not an option.

**Deliverable:** `gitsema status` prints blob count and total repo size.

---

### Phase 3 — Embedding system

**Goal:** A swappable embedding abstraction with a working local implementation.

Define a strict interface that all providers must satisfy:

```ts
export interface EmbeddingProvider {
  embed(text: string): Promise<Embedding>
  embedBatch?(texts: string[]): Promise<Embedding[]>
  readonly dimensions: number
  readonly model: string
}
```

Implement:

- `local.ts` — Ollama via `http://localhost:11434/api/embeddings`. Model is
  configurable (default `nomic-embed-text`). Dimensions are read from the first
  response so the schema can self-configure.
- `http.ts` — Generic HTTP provider for any OpenAI-compatible embeddings
  endpoint. Useful for self-hosted alternatives.

This phase is intentionally narrow. Do not integrate the provider into the
indexer yet. The only goal is confirming the interface is clean and the Ollama
call returns a correctly shaped `number[]`.

The `embeddings` table schema depends on `dimensions`, which varies by model.
Store vectors as `BLOB` (raw `Float32Array` bytes). Add a `model` column so you
can detect when the indexed model no longer matches the configured provider.

**Deliverable:** `gitsema status` reports the configured provider and model.
A standalone `embed.ts` script embeds a test string and prints the vector length.

---

### Phase 4 — Indexing

**Goal:** `gitsema index` works end-to-end.

Compose the walker, deduper, embedding engine, and database writes into a
single `Indexer` class. The processing pipeline per blob:

1. Check `blobs` table — if `blobHash` already present, skip entirely.
2. Read content via `showBlob`.
3. Generate embedding via provider.
4. Write to `blobs`, `embeddings`, `paths` in a single transaction.

The deduper (step 1) is the most important optimization in the entire project.
A blob that appears across 500 commits is embedded exactly once. On a real
codebase this cuts embedding calls by 80–95%.

Add basic progress output: blobs seen / new / skipped / failed, with a running
estimate of time remaining.

**Deliverable:** `gitsema index` runs to completion on a real repo. The
database is populated and queryable with raw SQL.

---

### Phase 5 — Search  ·  *MVP deliverable*

**Goal:** `gitsema search "query"` returns ranked results.

The search pipeline:

1. Embed the query string using the configured provider.
2. Load all stored embeddings from the database.
3. Compute cosine similarity between the query vector and each blob vector.
4. Sort descending by score, take top-k (default 10).
5. Join against `paths` to resolve file paths.
6. Print results: score · path · blob hash (short).

Cosine similarity in pure JS is fast enough for tens of thousands of blobs.
If the database grows beyond ~500k blobs, revisit with a vector index (Phase 9
or beyond). Do not prematurely optimize.

Example output:

```
0.921  src/auth/oauth.ts          [a3f9c2d]
0.887  src/auth/session.ts        [b19e4a1]
0.863  lib/middleware/jwt.ts      [c02d8f7]
```

**Deliverable:** A fully working CLI. Index any Git repo, search it
semantically. This is the point where the tool is genuinely useful for daily
development work, even without any commit awareness.

---

### Phase 6 — Commit mapping

**Goal:** The database understands Git history.

Extend the schema with two new tables:

```ts
commits: {
  commitHash: CommitHash   PRIMARY KEY
  timestamp:  number       -- Unix epoch
  message:    string       -- first line only
}

blobCommits: {
  blobHash:   BlobHash
  commitHash: CommitHash
}
```

Extend the indexer to populate these during `gitsema index`. For each commit
visited during `rev-list`, record it in `commits` and create `blobCommits` rows
linking blobs to the commits they appear in.

No new CLI commands in this phase. The work is entirely in the data model. This
is intentional — build the foundation before the queries that depend on it.

Note on volume: `blobCommits` can grow large (one row per blob per commit it
appears in). This is expected. Add a covering index on `(blobHash, commitHash)`
for the queries that Phase 7 will need.

**Deliverable:** After re-indexing, `commits` and `blobCommits` are populated.
Verify with raw SQL that `first-seen` queries are possible before building the CLI.

---

### Phase 7 — Time-aware queries  ·  *Phase 2 deliverable*

**Goal:** The index understands time.

Add three new capabilities:

**`gitsema first-seen "oauth"`**
Search blobs semantically → for each result, find the earliest commit in
`blobCommits` → sort by timestamp → show when that concept first appeared in
the codebase and in which file.

**`gitsema search "auth" --recent`**
Combine vector similarity with a recency boost. Score formula:

```
finalScore = α × cosineSimilarity + (1 − α) × recencyScore
```

where `recencyScore` normalizes commit timestamps to [0, 1] and `α` defaults
to 0.8. Expose `--alpha` to let users tune the balance.

**`gitsema search "middleware" --before 2023-01-01`**
Filter the candidate set to blobs whose earliest commit predates the given
timestamp before computing similarity. Also support `--after`.

**Deliverable:** All three commands work. You can now ask the codebase
questions with a temporal dimension, which is the core differentiator of
`gitsema` over conventional semantic search tools.

---

### Phase 8 — File-type-aware embedding models

**Goal:** Use the optimal embedding model per content type — a code-aware model for source files and a text model for documentation and prose.

Different content types benefit from different embedding models. Source code has a highly structured, syntax-rich vocabulary that is captured more faithfully by code-aware models (e.g. `nomic-embed-code`). Prose documentation benefits from general-purpose text models (e.g. `nomic-embed-text`). Routing each blob to its best-fit model improves search precision for both use cases without requiring any additional infrastructure.

**New environment variables**

| Variable | Default | Purpose |
|---|---|---|
| `GITSEMA_TEXT_MODEL` | `nomic-embed-text` | Model used for prose, documentation, and unknown file types |
| `GITSEMA_CODE_MODEL` | (same as text model) | Model used for source code files |

When `GITSEMA_CODE_MODEL` equals `GITSEMA_TEXT_MODEL` (the default), a single provider is used — the behaviour is identical to Phase 3 and fully backward-compatible.

**New modules**

- `src/core/embedding/fileType.ts` — classifies a file path as `'code'`, `'text'`, or `'other'` based on extension. Defines `CODE_EXTENSIONS` and `TEXT_EXTENSIONS` sets.
- `src/core/embedding/router.ts` — `RoutingProvider` that wraps a text provider and a code provider. `providerForFile(path)` returns the correct provider; `embed(text)` routes to the text provider (search queries are prose).

**Schema change**

Add a nullable `file_type` column to the `embeddings` table. Records the category (`code` / `text` / `other`) that was active when the embedding was produced. This makes it possible to detect mismatches if a blob is re-indexed with a different routing policy.

**Indexer change**

`IndexerOptions` gains an optional `codeProvider` field. When present, the indexer uses `RoutingProvider` to select the active model per blob before calling `embed()`. The `model` column in `embeddings` correctly reflects which model was actually used for each blob.

**Search query handling**

Search queries have no file path. `RoutingProvider.embed()` always delegates to the text provider. This ensures that natural-language queries are embedded with the same model used for prose files, which is the correct semantic space for matching against documentation.

**Deliverable:** `GITSEMA_CODE_MODEL=nomic-embed-code gitsema index` indexes code files with the code model and documentation with the text model. `gitsema status` reports both configured models when they differ. The `scripts/embed.ts` script accepts an optional file path argument and shows which model was selected for that file type.

---

### Phase 9 — Performance

**Goal:** Practical daily use on large repositories.

Three independent improvements, each mergeable separately:

**Incremental indexing**

Track which commits have been fully processed in a new `indexedCommits` table.
`gitsema index --since HEAD~100` (or `--since <hash>`) processes only new
commits, skipping blobs already in the database. On subsequent runs of
`gitsema index` with no flag, default to indexing only since the last indexed
commit.

**Parallel embedding**

Wrap embedding calls with `p-limit` for configurable concurrency (default 4).
Add batching where the provider supports `embedBatch`. Measure throughput
improvement; target 4–8x speedup on a cold index.

**File filtering**

```
--ext .ts,.js,.py      only index these extensions
--max-size 200kb       skip blobs larger than this
--exclude node_modules,dist,vendor
```

Filtering happens in the walker before any content is read or embeddings
are generated — it is purely a path-based check.

**Deliverable:** Re-indexing a large monorepo (e.g. 10k+ unique blobs) runs
in under 5 minutes on commodity hardware with a local Ollama instance.

---

### Phase 10 — Smarter semantics

**Goal:** Better results without changing the core architecture.

**Pluggable chunking**

Whole-file indexing works well for most cases but loses precision on large
files. Add an optional `--chunker` flag accepting a strategy name:

- `file` (default) — index the whole file as one blob
- `function` — split on function/class boundaries using tree-sitter
- `fixed` — fixed-size windows with overlap

Chunks are stored as separate embeddings with a `chunkOf` foreign key back to
the blob. Search results show the chunk's line range alongside the file path.

The chunker is pluggable by design. Resist adding more than `file` and
`function` in this phase.

**Improved ranking**

Combine three signals into a single score:

| Signal | Weight | Notes |
|---|---|---|
| Vector similarity | 0.7 | cosine, primary signal |
| Recency | 0.2 | normalized timestamp |
| Path relevance | 0.1 | keyword match between query and path |

Expose weights as `--weight-vector`, `--weight-recency`, `--weight-path`.

**Result grouping**

`gitsema search "retry logic" --group file` collapses multiple results from
the same file into one entry showing the top-scoring chunk. Also support
`--group module` (by directory) and `--group commit`.

**Deliverable:** Search results on a mature codebase are noticeably more
precise. The chunker integration does not regress performance on whole-file
indexing.

---

### Phase 11 — Advanced features + MCP

**Goal:** The full platform.

**`gitsema evolution src/auth/oauth.ts`**

Track how a file's semantic content has drifted over time. For each unique
blob hash the file has had, retrieve its embedding. Plot (or print) cosine
distance between successive versions. Large jumps indicate rewrites; gradual
drift indicates organic growth. Output is a timeline of (commit, date, distance
from previous, distance from origin).

`--dump [file]` outputs a structured JSON representation of the full timeline
to stdout (if no file given) or to a file while still printing the human-readable
summary to stdout. The JSON shape is:

```json
{
  "path": "src/auth/oauth.ts",
  "versions": 4,
  "threshold": 0.3,
  "timeline": [
    { "index": 0, "date": "2021-03-15", "blobHash": "...", "commitHash": "...",
      "distFromPrev": 0, "distFromOrigin": 0, "isOrigin": true, "isLargeChange": false }
  ],
  "summary": { "largeChanges": 1, "maxDistFromPrev": 0.412, "totalDrift": 0.401 }
}
```

**Semantic diff**

`gitsema diff HEAD~1 HEAD -- src/auth/oauth.ts`

Compare the embeddings of two versions of a file. Report cosine distance and,
optionally, the nearest neighbors of each version to characterize what each
version is "about" semantically.

**Hybrid search**

`gitsema search "oauth token" --hybrid`

Combine vector similarity (semantic) with BM25 keyword matching (lexical).
Implement BM25 in SQLite using FTS5. The final score is a weighted combination
of both signals. Hybrid search significantly improves precision when the query
contains specific technical terms that may not be well-represented by the
embedding alone.

**MCP layer**

Wrap the CLI as a set of MCP tools, exposing `gitsema` to Claude Code and any
other MCP client:

```ts
semantic_search(query: string, options?: SearchOptions): SearchResult[]
search_history(query: string, options?: TimeOptions): SearchResult[]
first_seen(query: string): FirstSeenResult[]
evolution(path: string): EvolutionResult[]
index(options?: IndexOptions): IndexStats
```

The MCP server is a thin adapter over the existing CLI logic — it shares the
same core modules and SQLite database. It does not duplicate logic.

**Deliverable:** `gitsema` is a complete semantic intelligence layer for Git
repositories, accessible both as a CLI tool for developers and as an MCP
server for AI-assisted workflows.

---

### Phase 11b — Content access and semantic concept tracking

**Goal:** Make the index richer for agent consumption; add concept-level evolution across history.

**`--include-content` on `evolution --dump`**

Extend the JSON dump produced by `gitsema evolution <path> --dump` with an optional
`--include-content` flag. When set, each timeline entry gains a `content` field
holding the full stored text of that blob version as it was recorded in the FTS5
index. This gives agents the raw file at each historical snapshot without any
extra tooling:

```json
{
  "index": 1,
  "date": "2022-06-10",
  "blobHash": "b19e4a1...",
  "content": "// full file text here...",
  "distFromPrev": 0.145,
  ...
}
```

`content` is `null` when the blob was indexed before the FTS5 table was introduced
(i.e. before Phase 11).

**`getBlobContent(blobHash)`**

New export from `src/core/indexing/blobStore.ts`. Retrieves the stored text for a
given blob hash from the FTS5 `blob_fts` table. Returns `undefined` when the blob
has no stored text. Used by both the CLI dump and the MCP tools.

**MCP `evolution` tool — `include_content` parameter**

The `evolution` MCP tool gains an `include_content: boolean` parameter (only
meaningful when `structured: true`). When enabled, each timeline entry in the
returned JSON includes the full stored file text, identical to the CLI flag above.

**`gitsema concept-evolution <query>`**

Semantic concept evolution: rather than tracking a single file, trace how a
*concept* (e.g. `"authentication"`) evolved across the entire codebase history.

Algorithm:

1. Embed the query string.
2. Score all indexed blobs by cosine similarity and select the top-k (default 50).
3. For each selected blob, resolve its earliest commit timestamp and file paths.
4. Sort the result set chronologically (oldest-first).
5. Compute `distFromPrev` between consecutive entries in the timeline.

Output is a timeline showing when each semantically related blob first appeared,
what file it lived in, how similar it is to the concept query, and how much the
code changed between successive related blobs:

```
2021-03-15  src/auth/session.ts                          [a3f9c2d]  score=0.892  dist_prev=0.000  (origin)
2021-06-22  src/auth/oauth.ts                            [b19e4a1]  score=0.912  dist_prev=0.145
2022-09-10  src/auth/jwt.ts                              [c02d8f7]  score=0.872  dist_prev=0.231  ← large change
```

Flags:

| Flag | Default | Purpose |
|---|---|---|
| `-k, --top <n>` | `50` | How many top-matching blobs to include |
| `--threshold <n>` | `0.3` | Distance threshold for flagging large changes |
| `--dump [file]` | — | Emit structured JSON to stdout or a file |
| `--include-content` | `false` | Add stored file text to each JSON entry (with `--dump`) |

The `--dump` JSON shape:

```json
{
  "query": "authentication",
  "entries": 12,
  "threshold": 0.3,
  "timeline": [
    { "index": 0, "date": "2021-03-15", "blobHash": "...", "commitHash": "...",
      "paths": ["src/auth/session.ts"], "score": 0.892,
      "distFromPrev": 0, "isOrigin": true, "isLargeChange": false }
  ],
  "summary": { "largeChanges": 2, "maxDistFromPrev": 0.231, "avgScore": 0.891 }
}
```

**MCP `concept_evolution` tool**

New MCP tool that exposes the same capability to agents:

```ts
concept_evolution(
  query: string,            // concept to trace, e.g. "authentication"
  top_k?: number,           // default 50
  threshold?: number,       // default 0.3
  structured?: boolean,     // return JSON instead of human-readable text
  include_content?: boolean // add stored file text per entry (with structured=true)
): string
```

**New module additions**

| Module | Addition |
|---|---|
| `src/core/indexing/blobStore.ts` | `getBlobContent(blobHash)` export |
| `src/core/search/evolution.ts` | `ConceptEvolutionEntry` interface, `computeConceptEvolution()` function |
| `src/cli/commands/conceptEvolution.ts` | CLI command handler |
| `src/mcp/server.ts` | `concept_evolution` tool registration |

**Deliverable:** Agents using the MCP layer can retrieve the full file content at
every historical version, and can ask "how did concept X evolve?" across the
entire codebase history — not just within a single file.

---

## Key technical decisions

| Decision | Choice | Rationale |
|---|---|---|
| Unit of identity | `blob_hash` | Immutable, content-addressed, dedup is free |
| Vector storage | `BLOB` (Float32Array bytes) | No extension required, portable |
| ORM | Drizzle | Lightweight, ESM-native, SQL-close |
| Similarity | Cosine in JS | Fast enough up to ~500k blobs |
| Embedding provider | Ollama (local) | Zero cost, GDPR-clean, swappable |
| CLI framework | `commander` or `citty` | Composable, scriptable |
| Concurrency | `p-limit` | Simple, no worker thread overhead |

## Risk register

| Risk | Mitigation |
|---|---|
| Repo explosion (millions of blobs) | Filters (Phase 9), vector index (post-Phase 11) |
| Embedding cost / latency | Blob dedup (Phase 4), batching (Phase 9) |
| Model change invalidates index | `model` column on embeddings, re-index detection |
| SQLite write contention | Single writer pattern, WAL mode |
| Slow cosine search at scale | KNN index with `sqlite-vss` or `pgvector` migration |

---

### Phase 12 — CLI consolidation & robust per-file indexing

**Goal:** Reduce top-level commands and make single-file indexing first-class and resilient.

Summary of recent changes:

- Consolidated `index-file` into `index --file` which accepts multiple paths.
- `gitsema index --file a b` runs per-file indexing in parallel, respecting `--concurrency`.
- `index --file` now uses the same multi-level fallback strategy as the main indexer:
  - Try whole-file embedding
  - On context-length errors: fallback to `function` chunker
  - If function chunks still exceed context: try fixed windows (1500 → 800) per chunk
- Removed the top-level `index-file` command to reduce first-level keywords.
- `status <file>` remains positional for quick checks.

Why this helps:

- Simplifies the CLI surface area while preserving expressiveness.
- Makes targeted indexing (single files) reliable for large files without manual retry.
- Keeps behavioral parity between bulk indexing and ad-hoc per-file indexing.

Next possible improvements:

- Expose fallback parameters (`fixed` window sizes, overlap) via CLI flags.
- Add `--file` to `mcp` / programmatic API surface for scripted workflows.

---

### Recent progress (snapshot: 2026-04-01)

- **Commit hash in outputs:** Short commit hashes are shown next to first-seen dates and in `status`/ranking outputs.
- **`--origin` for evolution:** `gitsema evolution` accepts an `--origin`/origin blob ref to anchor distance calculations.
- **Robust indexer fallbacks & counters:** Indexer now tracks `embedFailed` / `otherFailed` and applies a multi-stage fallback: whole-file → `function` chunker → fixed windows (1500, then 800, overlap 200).
- **Per-file indexing:** `index --file <paths...>` is implemented (parallel, respects `--concurrency`); `index-file` command removed.
- **Status improvements:** `status <file>` resolves repo-relative paths when run from subdirectories and prints a compact, aligned key/value summary.
- **Persistent logging & `--verbose`:** `logger` writes to `.gitsema/gitsema.log` with single-file rotation to `.gitsema/gitsema.log.1`. `--verbose` or `GITSEMA_VERBOSE=1` enables debug output to console and log.
- **Chunk listing (verbose):** `status --verbose` lists chunk ranges; to avoid leaking large content it now prints a compact snippet (first 15 chars of the first line and last 15 chars of the last line) per chunk.
- **Chunk dedupe & safety:** `storeChunk()` was hardened to avoid creating duplicate chunk rows; a dedupe script was run and found no exact duplicates.
- **Version reporting:** CLI reads `package.json` for the program version so `gitsema -V`/status show the actual package version.

These items reflect recent development iterations focused on reliability and observability for indexing large files and making per-file workflows predictable.

---

### Phase 13 — Standalone model server for embeddings

**Goal:** Provide a lightweight, local HTTP model-server that can download embedding models from Hugging Face, host them locally, and expose a stable HTTP embedding API for `gitsema` (or other tools) to consume. This decouples model hosting from the CLI, reduces cross-language integration friction, and makes it easier to run models on dedicated machines with GPUs.

Design decisions:

- Use Python + FastAPI for broad ecosystem support and easy deployment with `uvicorn`.
- Support two runtime paths: `sentence-transformers` models when available (simple API), and transformer-based models using `transformers` + `torch` with mean-pooling as a fallback.
- Use `huggingface_hub` to download and cache models locally; the server exposes a `/download` endpoint to fetch a model and a `/embed` endpoint to compute embeddings.
- Provide a minimal model registry in-memory that maps model names → loaded model objects; models can be preloaded at startup or downloaded on-demand.
- Return JSON embeddings (float32 list) and accept batch inputs. Include metadata (model, dims, device).

API (examples):

- `POST /download` { "model": "sentence-transformers/all-MiniLM-L6-v2" }
- `POST /embed` { "model": "all-MiniLM-L6-v2", "texts": ["hello world", "foo"] }

Security & production notes:

- Authentication is intentionally omitted in the first iteration; add API keys or mTLS for production.
- Provide an environment variable to restrict allowed HF models or to point at a private HF token via `HUGGINGFACE_TOKEN`.
- Expose metrics and health endpoints for orchestration.

Deliverables:

- `modelserver/server.py` — FastAPI app implementing `/download`, `/embed`, `/models`, `/health` endpoints.
- `modelserver/requirements.txt` — Pin of runtime deps: `fastapi`, `uvicorn`, `sentence-transformers`, `transformers`, `torch`, `huggingface-hub`.
- `modelserver/README.md` — Quick start and run commands.

This phase makes it easy to run a local embedding service that `gitsema` can point at via `GITSEMA_PROVIDER=http://localhost:8000` (or an HTTP provider shim). It also enables running heavier GPU-backed models on separate hardware without changing the CLI code.

---

#### Implementation snapshot (actions taken)

- **Environment:** started preparing a local modelserver scaffold (FastAPI) under `modelserver/`.
- **Git ignore:** added `modelserver/models/`, `.cache/huggingface/`, and `.cache/torch/` to `.gitignore` to avoid committing downloaded model artifacts.
- **CUDA preference:** intend to run the modelserver with `USE_CUDA=1` to prefer GPU when available.
- **Model targeted:** plan to download `nomic-ai/CodeRankEmbed` as a first test model; the server exposes `/download` to fetch models on-demand and `/embed` to compute embeddings.

---

Runbook (how to start and download `nomic-ai/CodeRankEmbed`):

1. Create a Python venv and install deps:

```bash
python -m venv .venv
.venv\Scripts\activate     # Windows
pip install -r modelserver/requirements.txt
```

2. Start the server preferring CUDA:

```bash
set USE_CUDA=1            # Windows CMD
# or PowerShell: $env:USE_CUDA = '1'
uvicorn modelserver.server:app --host 0.0.0.0 --port 8000
```

3. Download the model and verify embedding:

```bash
curl -X POST http://localhost:8000/download -H "Content-Type: application/json" \
  -d '{"model":"nomic-ai/CodeRankEmbed"}'

curl -X POST http://localhost:8000/embed -H "Content-Type: application/json" \
  -d '{"model":"nomic-ai/CodeRankEmbed","texts":["int main() { return 0; }"]}'
```

Notes:

- Model downloads can be large; set `HUGGINGFACE_TOKEN` if the model requires auth.
- If `sentence-transformers` loading fails, the server falls back to a `transformers` mean-pooling loader.

Run attempt note:

- A local attempt to install `modelserver` dependencies in a Windows dev environment failed while building native wheels (the `tokenizers` package requires a Rust toolchain). To run the server locally you may need to install Rust/Cargo or use a prebuilt environment (Docker/Conda) that provides the binary wheels.

---

### Phase 14 — Infrastructure, tooling, and maintenance

**Goal:** Close the operational gaps that exist now that the feature set is complete. No new search or indexing capabilities — this phase is about making the project reliable, testable, and easy to onboard.

**Items (priority order):**

**1. Test suite**

The single largest gap. Add a test framework (Vitest is the natural choice — ESM-native, TypeScript-first, no extra config).

- Integration tests for the indexer: create a small fixture Git repo in-process, run `runIndex`, assert blob/embedding/commit counts.
- Unit tests for chunking: cover `fileChunker`, `functionChunker`, `fixedChunker` with edge cases (empty file, single-function file, file that exceeds one window).
- Unit tests for search ranking: `cosineSimilarity`, `pathRelevanceScore`, `groupResults`.
- Integration test for hybrid search: index fixture repo with FTS5, assert BM25 path degrades gracefully to vector-only when query has no FTS5 hits.

Target: `pnpm test` runs green. Add to CI.

**2. CI/CD (GitHub Actions)**

Two workflows:

- `ci.yml` — triggered on every push and PR: `pnpm install`, `pnpm build` (type-check), `pnpm test`.
- `release.yml` — triggered on version tags (`v*`): build + publish to npm (or just GitHub Releases).

**3. `.env.example`**

Add a `.env.example` at repo root documenting all `GITSEMA_*` variables with inline comments. Referenced in README and CLAUDE.md.

**4. `gitsema backfill-fts` command**

Blobs indexed before Phase 11 have no FTS5 content. Add a maintenance command that iterates all blobs in the DB that have no `blob_fts` entry and re-fetches their content from the Git object store to populate the FTS5 table. Useful after upgrading from an older index.

**5. Schema migration**

Define a `gitsema migrate` command (or a startup check) that applies additive schema changes when the DB version is behind the current schema. Store a `schema_version` in a `meta` table. This prevents breakage when users upgrade gitsema against an existing `.gitsema/index.db`.

**6. Docker image for Phase 13 model server**

The Python model server is blocked on Windows because `tokenizers` requires a Rust toolchain at install time. Provide a `modelserver/Dockerfile` that uses a prebuilt Python image with the wheels already installed. This lets any platform run the model server without Rust or Conda.

```dockerfile
# modelserver/Dockerfile (sketch)
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Deliverable:** `pnpm test` is green, CI passes on PRs, new contributors can onboard from `.env.example` alone, and existing users with pre-Phase-11 indexes can recover full hybrid search via `backfill-fts`.

---

### Phase 14b — Search result deduplication

**Goal:** Each unique blob appears at most once in search results, even when chunk embeddings are included.

**Problem:** When `--chunks` is used (or chunks were indexed), `vectorSearch` adds one candidate entry per chunk for a given blob hash. After scoring, the top-K slice can return multiple entries for the same blob (e.g. chunks 3, 7, and 11 of the same file all land in the top 10). The caller sees the same file path listed three times with slightly different scores — confusing and wasteful.

**Fix — deduplicate by `blobHash` before slicing:**

In `vectorSearch` ([src/core/search/vectorSearch.ts](src/core/search/vectorSearch.ts)), after computing `finalScored` and sorting descending, group by `blobHash` and keep only the highest-scoring entry per blob before slicing to `topK`. The winning entry retains its `chunkId`/`startLine`/`endLine` so callers still know which chunk matched best.

```ts
// After sort, before slice:
const bestByBlob = new Map<string, FinalEntry>()
for (const entry of finalScored) {
  const existing = bestByBlob.get(entry.blobHash)
  if (!existing || entry.score > existing.score) {
    bestByBlob.set(entry.blobHash, entry)
  }
}
const topEntries = Array.from(bestByBlob.values())
  .sort((a, b) => b.score - a.score)
  .slice(0, topK)
```

This is strictly an improvement: the same blob hash appearing twice was never useful, and dedup-then-slice gives topK *distinct blobs* rather than topK *candidate vectors*.

**Scope:** Change is confined to `vectorSearch` in [src/core/search/vectorSearch.ts](src/core/search/vectorSearch.ts). No schema changes, no CLI flag changes. The existing `--group file` option (which deduplicates by path across different blob hashes) is orthogonal and unchanged.

**Deliverable:** `gitsema search "..." --chunks` returns at most one entry per unique file version. No regressions on non-chunk search paths.

---

### Phase 15 — Branch awareness

**Goal:** Correct `--since <ref>` indexing across all branches and add branch metadata to enable branch-scoped search.

**Two problems:**

1. **Bug** — `revList` ([src/core/git/revList.ts:50](src/core/git/revList.ts#L50)) uses `${since}..HEAD` for the ref/tag form of `--since`. This walks only commits reachable from HEAD, silently skipping blobs that exist exclusively on other branches. The date form (`--after`) correctly uses `--all`.

2. **No branch metadata** — The schema has no concept of which branches reference a blob. Users cannot ask "show me results only from `main`" or "what branches introduced this code?".

**Changes:**

**1. Fix `--since <ref>` in revList.ts**

Change the ref-range form from `${since}..HEAD` to `--all --not ${since}`. This gives all objects reachable from any ref that are not reachable from `<since>` — the correct multi-branch equivalent.

```ts
// Before:
revListArgs = ['rev-list', '--objects', `${since}..HEAD`]
// After:
revListArgs = ['rev-list', '--objects', '--all', '--not', since]
```

**File:** [src/core/git/revList.ts](src/core/git/revList.ts)

**2. Add `blob_branches` join table**

```ts
// schema.ts addition
blobBranches: {
  blobHash:   TEXT  FK → blobs.hash
  branchName: TEXT  -- short ref name (e.g. "main", "feature/auth")
  PRIMARY KEY (blobHash, branchName)
}
```

**Files:** [src/core/db/schema.ts](src/core/db/schema.ts), [src/core/db/sqlite.ts](src/core/db/sqlite.ts)

**3. Capture branch associations during indexing**

Before the streaming pass, build a `Map<commitHash, branchName[]>` by running `git log --all --format="%H %D"` and parsing the ref decorations (`%D`). During `streamCommitMap`, emit a `branches` field per commit event. The indexer writes `blob_branches` rows for each blob introduced by a commit.

**Files:** [src/core/git/commitMap.ts](src/core/git/commitMap.ts), [src/core/indexing/indexer.ts](src/core/indexing/indexer.ts), [src/core/indexing/blobStore.ts](src/core/indexing/blobStore.ts)

**4. `--branch <name>` flag on `gitsema index`**

Restricts indexing to a single branch (useful for large repos where only one branch matters):

```
gitsema index --branch feature/auth
```

Passes `refs/heads/<name>` instead of `--all` to both `revList` and `streamCommitMap`.

**File:** [src/cli/commands/index.ts](src/cli/commands/index.ts) (or equivalent — verify path), [src/cli/index.ts](src/cli/index.ts)

**5. `--branch <name>` filter on `gitsema search`**

Adds a JOIN on `blob_branches` to restrict results to blobs seen on the specified branch:

```
gitsema search "auth middleware" --branch main
```

**Files:** [src/core/search/vectorSearch.ts](src/core/search/vectorSearch.ts), [src/cli/commands/search.ts](src/cli/commands/search.ts)

**Deliverable:** `--since <tag>` correctly picks up blobs from all branches. `gitsema search "..." --branch main` scopes results to the main branch. `gitsema status` reports branch count in the index.

---

### Phase 16 — Remote-repository indexing (server-managed clone, optional in-memory index)

**Goal:** Add a third operational mode in which neither the Git repository nor the index database need to exist on the user's machine. The gitsema server accepts a remote Git URL and optional credentials, clones the repository into a temporary directory, runs the full indexing pipeline, and optionally holds the resulting index in an in-memory SQLite database so nothing is written to disk.

---

**Three-way positioning**

| Mode | Repo location | Index (SQLite) | Who clones |
|---|---|---|---|
| 1 — local | user's disk | `.gitsema/index.db` on user's disk | user (pre-existing repo) |
| 2 — client-server | user's disk | server's disk | user (pre-existing repo) |
| **3 — fully remote** | **remote Git host (GitHub, GitLab, etc.)** | **server memory or server disk** | **server, on demand** |

In Mode 3 the user only needs to know the remote URL and (optionally) a token. They never run `git clone` themselves and never store the repo or the index locally.

---

**Is cloning necessary?**

Yes, for general Git repos — Git's object protocol makes it the only portable way to walk full history across arbitrary hosts. However:

- A **shallow clone** (`--depth N` or `--shallow-since <date>`) is sufficient when only recent history is needed. This is much faster and uses far less disk space in the temp directory.
- A **full clone** is required for `evolution`, `first-seen`, and `concept-evolution` commands that need multi-commit history.
- GitHub/GitLab REST APIs could enumerate blobs without cloning, but that path is platform-specific, paginates at tree-level only, and cannot provide commit timestamps cheaply — not worth the complexity in Phase 16.

The clone lives in a temporary directory on the server and is deleted after indexing (or kept according to a configurable cleanup strategy — see below).

---

**Changes**

**1. Configurable DB path — in-memory SQLite support**

`src/core/db/sqlite.ts` currently hard-codes `.gitsema/index.db`. Add a `GITSEMA_DB_PATH` environment variable that overrides this path. When set to the special value `:memory:`, `better-sqlite3` opens an in-memory database. The index is then session-scoped: it exists for the lifetime of the server process and is lost on restart.

```ts
// sqlite.ts — resolve DB path from env
const DB_PATH = process.env.GITSEMA_DB_PATH ?? join(DB_DIR, 'index.db')
// When DB_PATH is ':memory:', mkdirSync is skipped (no directory needed)
```

For the fully-remote mode the recommended setup is:
```bash
GITSEMA_DB_PATH=:memory: node dist/cli/index.js serve
```

This means the server never writes any index data to disk. If durability is desired, set `GITSEMA_DB_PATH` to a real file path instead.

**Files:** `src/core/db/sqlite.ts`

---

**2. New server route: `POST /api/v1/remote/index`**

Triggers a server-side clone-and-index operation. No blob content is sent by the client — the server fetches everything itself.

*Request body (Zod-validated):*
```json
{
  "repoUrl": "https://github.com/owner/repo.git",
  "credentials": {
    "type": "token",
    "token": "ghp_..."
  },
  "cloneDepth": null,
  "indexOptions": {
    "since": null,
    "maxCommits": null,
    "concurrency": 4,
    "ext": [],
    "maxSize": "200kb",
    "exclude": [],
    "chunker": "file"
  }
}
```

`credentials` is optional (for public repos). `type` can be `"token"` (GitHub personal-access-token / GitLab token) or `"basic"` (username + password). SSH URLs are rejected in Phase 16 (deferred to Phase 17 — see notes below).

*Server-side flow:*

1. Validate request with Zod. Reject any `repoUrl` that is not an `https://` URL (security guard — prevents SSRF to internal services and path-injection).
2. Embed credentials directly in the clone URL so nothing is written to a credential file on disk:
   - Token: `https://<token>@github.com/owner/repo.git`
   - Basic: `https://<user>:<pass>@github.com/owner/repo.git`
3. Create a unique temp directory with `mkdtemp(join(os.tmpdir(), 'gitsema-'))`.
4. Run `git clone [--depth N] <url-with-credentials> <tmpDir>` via `spawn` (never via shell, so the credential-embedded URL does not leak to a shell history). **Note:** argv is still visible in `/proc/<pid>/cmdline` on Linux regardless of how the process is spawned, so credentials embedded in the URL *will* appear in `ps` output; Phase 17 replaces this with a `GIT_ASKPASS` helper script.
5. Call `runIndex({ repoPath: tmpDir, ...indexOptions })`.
6. In a `finally` block, clean up the temp directory according to `GITSEMA_CLONE_KEEP` (see item 4 below).
7. Return `IndexStats` as JSON.

*New files:*
- `src/server/routes/remote.ts` — route handler
- `src/server/routes/remote.test.ts` — integration test (Phase 14 test suite)

Register the router in `src/server/app.ts`:
```ts
import { remoteRouter } from './routes/remote.js'
// …
app.use(`${base}/remote`, remoteRouter({ textProvider, codeProvider, chunkerStrategy, concurrency }))
```

---

**3. Clone cleanup strategies — `GITSEMA_CLONE_KEEP`**

| Value | Behaviour |
|---|---|
| `always` | Delete temp clone immediately after indexing, whether it succeeded or failed. **(default)** |
| `on-success` | Delete only if indexing succeeds; keep on failure for manual inspection. |
| `keep` | Keep the clone indefinitely. On a subsequent call to `POST /remote/index` with the same URL, the server detects the existing clone and runs `git fetch --all` instead of a fresh clone. This is faster for incremental re-indexing. |

Implemented in a small helper `src/core/git/cloneRepo.ts`:
```ts
export interface CloneResult {
  tmpDir: string
  cleanup: () => Promise<void>
}

export async function cloneRepo(
  repoUrl: string,
  credentialsUrl: string, // URL with credentials embedded
  depth?: number,
): Promise<CloneResult>
```

The helper manages the temp-dir lifecycle and exposes a `cleanup()` callback that the route handler calls in its `finally` block.

**File:** `src/core/git/cloneRepo.ts`

---

**4. Incremental re-indexing of remote repos**

When `GITSEMA_CLONE_KEEP=keep` and the temp dir is preserved, a second call to `POST /remote/index` for the same URL should skip the full clone and instead run `git fetch --all` to update the existing clone. This requires the server to maintain a registry:

```ts
// In-memory map: normalised repo URL → existing clone path
const cloneRegistry = new Map<string, string>()
```

On each request:
1. Look up `cloneRegistry.get(normalisedUrl)`.
2. If found and the directory still exists: run `git fetch --all` in it.
3. If not found or directory missing: run `git clone` into a new temp dir and register it.

This registry is in-memory only (no file). It is lost on server restart.

**File:** `src/server/routes/remote.ts` (or a small `src/core/git/cloneRegistry.ts`)

---

**5. New CLI command: `gitsema remote-index <repoUrl>`**

A thin wrapper that calls `POST /api/v1/remote/index` on the configured `GITSEMA_REMOTE` server. Lets users trigger server-side indexing without curl.

```
gitsema remote-index https://github.com/owner/repo.git \
  --token ghp_... \
  --depth 500 \
  --concurrency 8
```

Flags mirror the `indexOptions` fields of the request body plus `--token`, `--username`, `--password` for credentials. After the call returns, the user can run `gitsema search` (which proxies through `GITSEMA_REMOTE`) to query the freshly built index.

**Files:** `src/cli/commands/remoteIndex.ts`, `src/cli/index.ts`

---

**6. New environment variables**

| Variable | Default | Description |
|---|---|---|
| `GITSEMA_DB_PATH` | `.gitsema/index.db` | Path to the SQLite database. Set to `:memory:` for a fully in-memory, session-scoped index. |
| `GITSEMA_CLONE_DIR` | `os.tmpdir()` | Parent directory for temporary Git clones. |
| `GITSEMA_CLONE_KEEP` | `always` | Clone cleanup strategy: `always` / `on-success` / `keep`. |

---

**Security considerations**

| Risk | Mitigation |
|---|---|
| SSRF / internal-host access via `repoUrl` | Enforce `https://` scheme. Resolve the hostname to IP *before* cloning and reject any address in a private or reserved range: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local), `::1`, `fc00::/7` (IPv6 unique-local, covers `fc*` and `fd*`), `fe80::/10` (IPv6 link-local). Resolving before cloning also prevents DNS-rebinding attacks where an attacker's hostname initially resolves to a public IP but flips to a private IP after the check. |
| Path traversal in temp dir | Use `mkdtemp` under `os.tmpdir()` — the OS guarantees a safe unique path. |
| Credential leakage in process list | Credentials embedded in the clone URL appear in `/proc/<pid>/cmdline` and `ps` output on Linux. Phase 17 improvement: pass credentials via a `GIT_ASKPASS` script written to a temp file with `chmod 600`, deleted immediately after clone. |
| Credential leakage in logs and error responses | Strip `user:pass@` from the URL before passing it to `logger` or returning it in any API error response. Apply the same sanitisation to exception messages thrown by `git clone` (e.g. git may echo the URL back on auth failure). |
| Large / malicious repos | Enforce a `GITSEMA_CLONE_MAX_BYTES` limit (default `2 GB`) by monitoring the temp dir size during clone; abort and clean up if exceeded. |
| DoS via parallel clone requests | Gate `POST /remote/index` behind a server-wide semaphore (default: 2 concurrent clones). |

---

**What is NOT in scope for Phase 16**

- **SSH repository URLs** — require temp SSH key files + `ssh-agent` configuration. Deferred to Phase 17.
- **Multi-repo in-memory sessions** — a single in-memory DB is shared across all repos in the same server process. A per-repo DB registry is a Phase 17 concern.
- **Streaming progress** — `POST /remote/index` is a synchronous long-poll. Server-Sent Events for live progress are a Phase 17 nice-to-have.
- **Authentication to the gitsema server itself** — the existing `GITSEMA_SERVER_KEY` / `authMiddleware` already covers this. No new server auth is needed.

---

**Deliverables**

- `GITSEMA_DB_PATH=:memory:` makes the server run with a fully in-memory index — no disk writes.
- `POST /api/v1/remote/index` on the gitsema server accepts a HTTPS Git URL plus optional token/basic credentials, clones the repo in a server-side temp dir, indexes it, cleans up the clone, and returns `IndexStats`.
- `gitsema remote-index <url>` CLI command is a one-liner that triggers remote indexing without curl.
- SSRF and credential-leakage guards are in place from day one.
