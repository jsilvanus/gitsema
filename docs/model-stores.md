# Model Stores & Quantization

> **Status (Phase 35):** Multi-model DB storage, per-command model flags, `clear-model` command, and multi-model search are now implemented. The sections below reflect the current state as of Phase 35 (v0.34.0).

---

## Table of Contents

1. [What Is a "Model Store" in gitsema?](#1-what-is-a-model-store-in-gitsema)
2. [Provider Architecture](#2-provider-architecture)
3. [Multiple Providers: What Is and Isn't Supported](#3-multiple-providers-what-is-and-isnt-supported)
4. [Configuration & Selection](#4-configuration--selection)
5. [Quantization Support](#5-quantization-support)
6. [Existing Documentation Coverage](#6-existing-documentation-coverage)
7. [Gaps & Recommended Improvements](#7-gaps--recommended-improvements)

---

## 1. What Is a "Model Store" in gitsema?

gitsema does not use the term "model store" internally. The closest equivalent concept is an **embedding provider**: a runtime object that implements the `EmbeddingProvider` interface and wraps an HTTP endpoint (either a local Ollama daemon or a remote OpenAI-compatible API). The provider is the only gateway through which model artifacts are discovered and used — gitsema never manages model files directly.

**Key source location:**
- `src/core/embedding/provider.ts` — the `EmbeddingProvider` interface (lines 3–8):

  ```ts
  export interface EmbeddingProvider {
    embed(text: string): Promise<Embedding>
    embedBatch?(texts: string[]): Promise<Embedding[]>
    readonly dimensions: number
    readonly model: string
  }
  ```

  `dimensions` is lazily discovered from the first response, so the system adapts to whichever model is loaded in the backend. `model` is a string label used for database bookkeeping (the `model` column in the `embeddings` table ensures a re-index is flagged when the configured model changes).

---

## 2. Provider Architecture

### Concrete implementations

| Class | File | Backend | Notes |
|---|---|---|---|
| `OllamaProvider` | `src/core/embedding/local.ts` | Ollama HTTP API at `localhost:11434` | Default; model name configurable via `GITSEMA_MODEL` |
| `HttpProvider` | `src/core/embedding/http.ts` | Any OpenAI-compatible `/v1/embeddings` endpoint | Supports `Authorization: Bearer` token |

`OllamaProvider` (lines 17–56 of `local.ts`) calls `/api/embeddings` and reads `data.embedding`. `HttpProvider` (lines 18–67 of `http.ts`) calls `/v1/embeddings` and reads `data.data[].embedding`. Both implement `embedBatch` via parallel `embed` calls.

### Routing layer

`src/core/embedding/router.ts` — `RoutingProvider` (lines 12–45):

```ts
export class RoutingProvider {
  constructor(
    readonly textProvider: EmbeddingProvider,
    readonly codeProvider: EmbeddingProvider,
  ) { ... }

  providerForFile(filePath: string): EmbeddingProvider { ... }
  async embedFile(text: string, filePath: string): Promise<Embedding> { ... }
  async embed(text: string): Promise<Embedding> { ... } // always uses textProvider
}
```

`RoutingProvider` selects between exactly two providers based on the file extension classification in `src/core/embedding/fileType.ts`:

- `code` (`.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, etc.) → `codeProvider`
- `text` (`.md`, `.txt`, `.rst`, etc.) → `textProvider`
- `other` (everything else) → `textProvider` (fallback)

Full extension lists: `CODE_EXTENSIONS` (lines 11–32 of `fileType.ts`) and `TEXT_EXTENSIONS` (lines 37–40).

**Search queries always use `textProvider`** — this is hard-coded at line 42 of `router.ts`, because queries are natural-language prose regardless of what was indexed.

### How the indexer gets a provider

`src/core/indexing/indexer.ts` — `IndexerOptions` (lines 29–81):

```ts
export interface IndexerOptions {
  provider: EmbeddingProvider       // text provider (required)
  codeProvider?: EmbeddingProvider  // code provider (optional)
  ...
}
```

When `codeProvider` is provided, the indexer wraps both into a `RoutingProvider`. When omitted, all files use `provider` directly — backward-compatible single-model behaviour.

---

## 3. Multiple Providers: What Is and Isn't Supported

### What IS supported (Phase 35+)

| Capability | Notes |
|---|---|
| **Two models simultaneously** (code + text) | Fully supported via `RoutingProvider`. Enabled by setting `GITSEMA_CODE_MODEL` ≠ `GITSEMA_TEXT_MODEL`. |
| **Multiple embeddings per blob in DB** | **Phase 35**: `embeddings` table PK changed to `(blob_hash, model)`. A blob can now have embeddings from multiple models without conflict. |
| **Ollama or HTTP backend** | Mutually exclusive per process; `GITSEMA_PROVIDER=ollama\|http`. |
| **Remote server delegation** | `gitsema serve` runs as a standalone HTTP server; `GITSEMA_REMOTE` points the CLI at it. The server itself runs one provider pair. |
| **Per-repo config overrides** | `.gitsema/config.json` can set different `model` / `codeModel` per repository. |
| **Per-command model override** | **Phase 35**: `--model`, `--text-model`, `--code-model` flags on `index`, `search`, `first-seen`, `evolution`, `concept-evolution`, `diff`, `clusters`. |
| **Removing old model data** | **Phase 35**: `gitsema clear-model <model>` deletes all embeddings and cache for a given model. |
| **Multi-model search** | **Phase 35**: When `textModel ≠ codeModel`, `search` embeds the query with both models, runs two vector scans, and merges via `mergeSearchResults()`. |

### What is NOT supported

| Capability | Status |
|---|---|
| **Three or more simultaneous providers** | Not supported. `RoutingProvider` is hard-wired to exactly two slots (`textProvider` + `codeProvider`). |
| **Named "model store" profiles** | No registry or profile/named-slot mechanism. Workaround: use per-repo `.gitsema/config.json`. |
| **Hot-switching models during a run** | Not supported. The indexer holds a single `RoutingProvider` for its entire lifetime. |
| **Mixing Ollama and HTTP within the same run** | Not supported. Both providers must use the same backend type (`GITSEMA_PROVIDER`). |
| **Automatic backend discovery/fallback** | Not implemented. If the Ollama daemon is not running, the first `embed()` call throws. |

---

## 4. Configuration & Selection

### Precedence chain (highest → lowest)

```
Environment Variables (or CLI --model / --text-model / --code-model flags)
  > Local config (.gitsema/config.json)
    > Global config (~/.config/gitsema/config.json)
      > Hard-coded defaults
```

Implemented in `src/core/config/configManager.ts`, function `getConfigValue` (lines 278–304).

At CLI startup, `applyConfigToEnv()` (lines 399–419 of `configManager.ts`) reads config files and injects any unset env vars — so config files transparently participate in the same precedence chain without requiring consumers to call `getConfigValue`.

**Phase 35**: `applyModelOverrides()` in `src/core/embedding/providerFactory.ts` applies per-command `--model` / `--text-model` / `--code-model` overrides to `process.env` before any provider is constructed. This means a single command run can use a different model without affecting the persistent config.

### All model-related config keys

| Config key | Env var | Default | Description |
|---|---|---|---|
| `provider` | `GITSEMA_PROVIDER` | `ollama` | Backend type: `ollama` or `http` |
| `model` | `GITSEMA_MODEL` | `nomic-embed-text` | Fallback model name (used when textModel/codeModel not set) |
| `textModel` | `GITSEMA_TEXT_MODEL` | `$GITSEMA_MODEL` | Model for prose, docs, and unknown file types |
| `codeModel` | `GITSEMA_CODE_MODEL` | `$GITSEMA_TEXT_MODEL` | Model for source code files |
| `httpUrl` | `GITSEMA_HTTP_URL` | *(required if http)* | Base URL for HTTP provider |
| `apiKey` | `GITSEMA_API_KEY` | *(optional)* | Bearer token for HTTP provider |

Source: `ENV_KEY_MAP` in `configManager.ts` (lines 42–55) and `ALL_KEYS` (lines 61–101).

### How to select a different model without code changes

**Via CLI flag (per-command, one-shot):**
```bash
gitsema index --model nomic-embed-code
gitsema search "authentication" --code-model nomic-embed-code --text-model nomic-embed-text
```

**Via environment variables (session-level):**
```bash
export GITSEMA_CODE_MODEL=nomic-embed-code
export GITSEMA_TEXT_MODEL=nomic-embed-text
gitsema index
```

**Via local repo config (persistent, repo-level):**
```bash
gitsema config set codeModel nomic-embed-code
gitsema config set textModel nomic-embed-text
```
Writes to `.gitsema/config.json`. Effective on next command invocation.

**Via global config (persistent, user-level):**
```bash
gitsema config set --global codeModel nomic-embed-code
```
Writes to `~/.config/gitsema/config.json`.

**Switching to an HTTP backend (e.g., OpenAI):**
```bash
export GITSEMA_PROVIDER=http
export GITSEMA_HTTP_URL=https://api.openai.com
export GITSEMA_MODEL=text-embedding-3-small
export GITSEMA_API_KEY=sk-...
gitsema index
```

### Changing the model on an existing index

Because the `embeddings` table now uses a composite `(blob_hash, model)` primary key (Phase 35, schema v10), **changing the model does not invalidate or remove existing embeddings**. Old embeddings remain in the DB under their original model name.

When you re-index with a new model:
- Blobs that don't yet have an embedding for the new model are indexed.
- Blobs that already have an embedding for the new model are skipped.
- Blobs that only have an embedding for an old model are re-indexed (they will have two rows in `embeddings` after the run).

To remove old embeddings and free space:
```bash
gitsema clear-model nomic-embed-text   # removes all data for that model
```

### `gitsema clear-model <model>`

**Phase 35**: New command. Deletes from:
- `embeddings WHERE model = ?`
- `chunk_embeddings WHERE model = ?`
- `symbol_embeddings WHERE model = ?`
- `commit_embeddings WHERE model = ?`
- `module_embeddings WHERE model = ?`
- `query_embeddings WHERE model = ?` (cache)

Does **not** delete `blobs`, `paths`, or `blob_commits` rows — structural metadata is model-agnostic.

```bash
gitsema clear-model nomic-embed-text           # prompts for confirmation
gitsema clear-model nomic-embed-text --yes     # skips confirmation
```

### Query cache behavior on model switch

The `query_embeddings` cache (`src/core/embedding/queryCache.ts`) keys each entry on `(query_text, model)` (see `setCachedQueryEmbedding` line 43, sqlite migration v3 in `sqlite.ts`). This means:

- **Switching the model does not serve stale cache entries.** A query run with model A is cached under `(query, model-A)`. The same query with model B will miss the cache and embed fresh, then be cached under `(query, model-B)`.
- **Old cache entries for retired models persist** until TTL expiry (default 7 days, controlled by `GITSEMA_QUERY_CACHE_TTL_DAYS`) or until `gitsema clear-model <old-model>` is run.
- **TTL and size cap** are governed by `pruneQueryEmbeddingCache()` in `queryCache.ts`: default TTL = 7 days, default max entries = 10,000. Called automatically during each search run.

### Serve-mode provider wiring

`src/cli/commands/serve.ts` (lines 58–65):
```ts
const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
const codeModel = process.env.GITSEMA_CODE_MODEL ?? textModel
const textProvider = buildProvider(providerType, textModel)
const codeProvider = codeModel !== textModel ? buildProvider(providerType, codeModel) : undefined
```

When `codeModel === textModel` (the default), `codeProvider` is `undefined` and the server does not instantiate a second provider.

---

## 5. Quantization Support

### Short answer: **gitsema has no quantization support of its own.**

A full-text search across the entire codebase (TypeScript sources, JSON, and Markdown) for any of: `quantiz`, `int8`, `int4`, `quant`, `gguf`, `bitsandbytes`, `.bits`, `quantization` — returned **zero matches**. Quantization is entirely absent from the gitsema codebase.

### What this means in practice

Quantization lives **entirely in the embedding backend**, not in gitsema:

- **Ollama**: If you pull a quantized model (e.g., `ollama pull nomic-embed-text:q4_K_M`) and set `GITSEMA_MODEL=nomic-embed-text:q4_K_M`, gitsema will use it transparently. Ollama handles quantization internally (GGUF format, GGML/llama.cpp runtime). The `dimensions` value will be identical to the non-quantized variant (quantization affects weights, not output dimension).
- **HTTP/OpenAI-compatible servers** (vLLM, LM Studio, llama.cpp server, Hugging Face TEI): If the server is configured to load a quantized model (e.g., GPTQ, AWQ, bitsandbytes int8), gitsema calls the standard `/v1/embeddings` endpoint and receives the same float32 array. The quantization method is invisible to gitsema.

### No gitsema-side knobs

| Feature | Status |
|---|---|
| int8 output quantization (compress stored vectors) | **Not implemented** — see `docs/plan_vss.md` for the planned implementation |
| int4 output quantization | **Not implemented** |
| Binary / 1-bit embeddings | **Not implemented** |
| Configuration for quantization type | **No config key exists** |

Stored embeddings are always raw `Float32Array` bytes (4 bytes per dimension). See `blobStore.ts` for the storage format and `vectorSearch.ts` for the retrieval + cosine computation. Any dimension reduction or quantization of stored vectors would require schema changes to the `embeddings` table.

See **`docs/plan_vss.md`** for the detailed plan to add int8 vector quantization, a vector index (sqlite-vss / usearch), and ANN search as a future phase.

---

## 6. Existing Documentation Coverage

| Document | What it covers | Model store / quantization coverage |
|---|---|---|
| `CLAUDE.md` (root) | Architecture, CLI reference, config keys, design constraints | Model routing and env vars documented; quantization not mentioned |
| `docs/PLAN.md` | Phase history, architecture decisions, risk register | Phase 8 covers `RoutingProvider`; Phase 35 covers multi-model DB; quantization in risk register |
| `docs/plan_vss.md` | **Phase 36 plan**: vector index, int8 quantization, ANN search | Full quantization design |
| `docs/model-stores.md` (this file) | Model store architecture, multi-model, quantization, clear-model, cache behavior | Full coverage |
| `docs/commands.md` | Command grouping analysis | No provider/model content |
| `docs/SECTION2.md` | Known weaknesses: chunker, path scoring | No provider/model content |

---

## 7. Gaps & Recommended Improvements

### Implemented in Phase 35 ✅

- Multi-model DB schema (`embeddings` composite PK `(blob_hash, model)`) — schema v10
- `gitsema clear-model <model>` command
- `--model` / `--text-model` / `--code-model` per-command flags on `index`, `search`, `first-seen`, `evolution`, `concept-evolution`, `diff`, `clusters`
- Multi-model search (dual-model merge in `search` command via `mergeSearchResults()`)
- `gitsema status` model-mismatch warning
- Query cache key strategy documented (this file, section 4)

### Still pending

| Item | Notes |
|---|---|
| **int8 vector quantization of stored vectors** | Planned in `docs/plan_vss.md`. Would reduce storage 4× and speed up cosine. |
| **Three or more simultaneous models** | `RoutingProvider` only supports two slots. Extensible to N with a `Map<FileCategory, EmbeddingProvider>` refactor. |
| **Named provider profiles** | No profile/named-slot mechanism. Workaround: per-repo config. |
| **Per-command model flag on `author`, `impact`, `dead-concepts`, `semantic-blame`** | Not yet added. Follow the same `applyModelOverrides` pattern from `providerFactory.ts`. |
| **`--hybrid` multi-model** | Hybrid (BM25 + vector) search uses only the text provider path; dual-model does not participate in hybrid mode. |
| **`gitsema status --models` flag** | Lists all distinct models present in the DB. Currently only warns on mismatch. |

---

*Document updated Phase 35 (v0.34.0), 2026-04-04.*

