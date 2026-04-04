# Model Stores & Quantization — Research Document

> **Scope:** This document investigates (a) whether gitsema supports multiple model stores and how selection among them works, and (b) whether quantization is supported. It is a read-only research artifact — no code changes were made.

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

### What IS supported

| Capability | Notes |
|---|---|
| **Two models simultaneously** (code + text) | Fully supported via `RoutingProvider`. Enabled by setting `GITSEMA_CODE_MODEL` ≠ `GITSEMA_TEXT_MODEL`. |
| **Ollama or HTTP backend** | Mutually exclusive per process; `GITSEMA_PROVIDER=ollama\|http`. |
| **Remote server delegation** | `gitsema serve` runs as a standalone HTTP server; `GITSEMA_REMOTE` points the CLI at it. The server itself runs one provider pair. |
| **Per-repo config overrides** | `.gitsema/config.json` can set different `model` / `codeModel` per repository. |

### What is NOT supported

| Capability | Status |
|---|---|
| **Three or more simultaneous providers** | Not supported. `RoutingProvider` is hard-wired to exactly two slots (`textProvider` + `codeProvider`). |
| **Named "model store" profiles** (e.g., choose store "tomorrow" by name) | No such concept exists. There is no registry, profile, or named slot mechanism. |
| **Selecting a provider at query time** (without changing env/config) | Not supported. The provider is constructed once at process start and used for the entire session. |
| **Hot-switching models during a run** | Not supported. The indexer holds a single `RoutingProvider` for its entire lifetime. |
| **Mixing Ollama and HTTP within the same run** | Not supported. `buildProvider()` in `src/cli/commands/serve.ts` (line 16) and the equivalent in `src/cli/commands/index.ts` use a single `GITSEMA_PROVIDER` value for both the text and code providers. Both providers must use the same backend type. |
| **Automatic backend discovery/fallback** | Not implemented. If the Ollama daemon is not running, the first `embed()` call throws. |

**Key design constraint (from `CLAUDE.md`):**
> Search queries always use the text provider (not the code provider), since queries are natural language.

This constraint is implemented at `router.ts:42` and is not overridable at runtime.

---

## 4. Configuration & Selection

### Precedence chain (highest → lowest)

```
Environment Variables
  > Local config (.gitsema/config.json)
    > Global config (~/.config/gitsema/config.json)
      > Hard-coded defaults
```

Implemented in `src/core/config/configManager.ts`, function `getConfigValue` (lines 278–304).

At CLI startup, `applyConfigToEnv()` (lines 399–419 of `configManager.ts`) reads config files and injects any unset env vars — so config files transparently participate in the same precedence chain without requiring consumers to call `getConfigValue`.

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
| int8 output quantization (compress stored vectors) | **Not implemented** |
| int4 output quantization | **Not implemented** |
| Binary / 1-bit embeddings | **Not implemented** |
| Configuration for quantization type | **No config key exists** |

Stored embeddings are always raw `Float32Array` bytes (4 bytes per dimension). See `blobStore.ts` for the storage format and `vectorSearch.ts` for the retrieval + cosine computation. Any dimension reduction or quantization of stored vectors would require schema changes to the `embeddings` table.

### Risk register note

The existing risk register in `docs/PLAN.md` (§ Risk register, ~line 671) notes:
> Cosine at scale: Pure-JS cosine works to ~500K blobs. `sqlite-vss` or DuckDB migration path is in the risk register but not designed.

Switching to a vector index library (e.g., `sqlite-vss`, `usearch`, `faiss`) would naturally bring int8 quantization into scope for stored vectors. This is the most likely future path for quantization.

---

## 6. Existing Documentation Coverage

| Document | What it covers | Model store / quantization coverage |
|---|---|---|
| `CLAUDE.md` (root) | Architecture, CLI reference, config keys, design constraints | Model routing and env vars documented; quantization not mentioned |
| `docs/PLAN.md` | Phase history, architecture decisions, risk register | Phase 8 covers `RoutingProvider`; quantization absent |
| `docs/commands.md` | Command grouping analysis | No provider/model content |
| `docs/SECTION2.md` | Known weaknesses: chunker, path scoring | No provider/model content |
| `docs/SECTION3.md` | Potential future use-cases | No provider/model content |

### Notable gaps

1. No single reference document for all model-related configuration.
2. No documentation on backend-side quantization (how to use a quantized model with Ollama or an HTTP server).
3. No documentation on the `RoutingProvider` two-model routing logic or the file category classification.
4. No documentation on the `query_embeddings` cache (`src/core/embedding/queryCache.ts`) — relevant to model switching (changing the model does not automatically invalidate the cache; entries are keyed on `(query_text, model)` which handles this correctly, but this is not documented anywhere).

---

## 7. Gaps & Recommended Improvements

### A. Concurrency / multiple model store support

**Gap:** There is no mechanism for registering more than two models simultaneously, and no profile/named-store concept for "use model X for file group Y and model Z for file group W".

**Recommended improvements:**

1. **Extend `RoutingProvider` to support N models** — Replace the hard-wired `textProvider`/`codeProvider` pair with a `Map<FileCategory, EmbeddingProvider>` to allow finer-grained routing (e.g., separate models for SQL, shell scripts, Markdown).
2. **Add named provider profiles** — Allow config keys like `profiles.default.codeModel = nomic-embed-code` and `profiles.fast.codeModel = mxbai-embed-large` with a `--profile` CLI flag on `index` and `search` commands.
3. **Document the current two-model routing** — Add a section to `CLAUDE.md` or a new `docs/embedding-providers.md` explaining `RoutingProvider`, `fileType.ts`, and the query routing rule.

### B. Quantization

**Gap:** gitsema stores all vectors as float32 and has no int8/int4 quantization support for stored vectors.

**Recommended improvements:**

1. **Document backend quantization** — Add a note to `CLAUDE.md` and/or a new embedding guide explaining that Ollama quantized model tags work transparently (e.g., `nomic-embed-text:q4_K_M`).
2. **Consider int8 scalar quantization of stored vectors** — For the ~500K-blob scale ceiling, int8 quantization of the stored `Float32Array` would reduce storage by 4× and speed up cosine computation. This requires a schema migration (add a `quantized` flag and change the `BLOB` storage type in `embeddings`) and updated cosine computation in `vectorSearch.ts`. This is low-risk and high-value as a Phase 34+ candidate.
3. **Track in risk register** — Explicitly add "int8 vector quantization for scale" to the risk register alongside the existing `sqlite-vss` note.

### C. Provider selection ergonomics

**Gap:** There is no way to switch the active model without modifying env vars or config files and restarting the process. Per-command `--model` override does not exist.

**Recommended improvements:**

1. **Add `--model` / `--code-model` flags to `gitsema index`** — These would override `GITSEMA_MODEL`/`GITSEMA_CODE_MODEL` for a single run without touching config files.
2. **Document the "double re-index" danger** — If the model is changed after a partial index, blobs already in the DB were embedded with the old model. The `model` column in `embeddings` records the model per blob, but there is no CLI warning when the configured model differs from the most recently stored model. A `gitsema status` warning for model mismatch would be a low-effort, high-value improvement.

### D. Cache invalidation on model switch

**Gap:** The `query_embeddings` cache in `src/core/embedding/queryCache.ts` keys entries on `(query_text, model)` (line 43). This is correct, but undocumented. If a user switches `GITSEMA_MODEL` and re-runs a search, the old cached embedding is silently ignored and a new one is computed. The cache is never invalidated when the `model` column changes in `embeddings` — stale cached entries for retired model names persist until TTL expiry (default 7 days).

**Recommended:** Document the cache key strategy and add a `gitsema cache clear` command or expose cache pruning via `gitsema status`.

---

*Document written 2026-04-04. Code base version: 0.32.0.*
