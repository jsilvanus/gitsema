# gitsema → Kotlin Port: Design Specification

**Status:** Phase 1 specification, approved 2026-08-04 (§9.2's vector-search
redesign approved as written; §12 — the tool description/interpretation catalog —
added after initial review). Tier 1 implementation is in progress in
`gitsema-kotlin` against this spec.
**Companion repo:** `github.com/jsilvanus/gitsema-kotlin` (Kotlin Multiplatform, JVM +
Android targets). First consumer: Aidos (`github.com/jsilvanus/aidos`), an
offline-first Android-first AI development environment. This document is the sole
implementation reference for that port — an implementer should never need to open
gitsema's TypeScript source to build Tier 1 or Tier 2.

**How this document was built:** mined from `src/core/{chunking,embedding,search,
indexing,storage,db,graph,git}`, `docs/knowledge-graph.md`, `docs/patterns.md`,
`docs/parity.md`, `docs/locked-model-set-plan.md`, `docs/storage-backends-plan.md`,
`docs/prebuilt-index-distribution-plan.md`, `docs/review10.md`, `docs/review11.md`,
and `CLAUDE.md`. Every constant below is given with a citation and, where the
codebase or docs state one, a reason. Where no reason exists in the source, this
document says so explicitly rather than inventing one — an unexplained constant is
flagged, not laundered into a design rationale it never had.

**Two corrections to the porting brief**, found during research and load-bearing
for what follows:
1. The speed/balanced/quality embedding profiles are **not** batch sizes 4/8/1.
   The real values (`src/core/indexing/adaptiveTuning.ts:34-50`) are `speed:
   {concurrency 8, batch 32, chunker file}`, `balanced: {concurrency 4, batch 16,
   chunker file}`, `quality: {concurrency 2, batch 4, chunker function}`. See §3.2.
2. The three-signal ranking's recency term is **not** exponential decay. It is
   linear min-max normalization of first-seen timestamps *within the current
   candidate pool* (`src/core/search/temporal/timeSearch.ts:115-132`). See §4.2.

---

## 1. Identity

### 1.1 Blob-hash identity (the base layer)

Every operation in gitsema pivots on `blob_hash` — Git's own SHA-1 content hash —
never on file path or commit. `blobs.blob_hash` is the primary key
(`src/core/db/schema.ts:30-34`); `embeddings` is keyed on the composite
`(blob_hash, model)`; `paths` maps one blob hash to many file paths, `UNIQUE
(blob_hash, path)` (added schema v20, to stop duplicate rows once the same blob
resurfaces at the same path across commits); `blob_commits` is the many-to-many
join between blobs and commits.

**Dedup mechanism** (`src/core/indexing/deduper.ts`): `isIndexed(blobHash, model)`
is `SELECT 1 FROM embeddings WHERE blob_hash=? AND model=?`. `filterNewBlobs()`
batches this in groups of 500 hashes (SQLite's bound-parameter ceiling headroom)
and returns only the subset with no embedding row for that model. Because the key
is `(blob_hash, model)` and not `blob_hash` alone, the *same* blob can carry
embeddings under multiple models simultaneously (multi-model support), and
re-indexing under a *new* model name is always safe and additive.

**Write atomicity** (`src/core/indexing/blobStore.ts:50-81`): `storeBlob()` writes
blob + embedding + path + FTS5 content inside one SQLite transaction, using
`ON CONFLICT DO NOTHING` at every insert. The function is explicitly documented as
safe to call repeatedly for the same blob hash under different paths — the
blob/embedding rows no-op on repeat, a new path row is added. **This one blob-atomic
transaction is the actual unit of resumability** in the whole indexer (see §8.2) —
everything above it is best-effort and re-walkable, everything at or below it is
either fully durable or fully absent.

**Why this matters for the Kotlin port:** content-addressing is what makes
interruption-safety, dedup-across-history, and dedup-across-machines (§7.4,
`prebuilt-index-distribution-plan.md`) all the same mechanism. Nothing about it is
TypeScript-specific; it ports directly. The one thing that must **not** port
directly is the write granularity when adapted to a suspend/coroutine world — see
§8.2 for the concrete resumability gap to close, not just preserve.

### 1.2 The two-level graph identity (why it's shaped the way it is)

This is the sharpest idea in the codebase, and the one place blob-first immutability
and stable cross-time identity would otherwise contradict each other.

**The tension** (`docs/knowledge-graph.md` §2, restated precisely): the structural
graph wants edges like "A calls B" to survive across `A`'s edit history — the same
function, lightly modified, should still be the same graph node. But gitsema is
blob-first: every edit produces a new `blob_hash`, and a blob has no single path (it
can appear at many paths; a path can host many historical blobs). Neither a raw
blob hash nor a raw file path can be a graph node's stable key.

**The resolution is a two-level split, not a compromise between the two:**

| Level | Identity | Lifecycle | Table |
|---|---|---|---|
| **Symbol occurrence** | Path-free: `(blob_hash, qualified_name, signature_hash)` | Immutable — extracted once per blob hash, never recomputed | `symbols` (+ `structural_refs` for import/call/heritage sites) |
| **Graph node** | `node_key` string, e.g. `symbol:<path>#<qualified_name>#<signature_hash>` | Recomputable — truncate-and-rebuilt wholesale | `graph_nodes` / `edges` |

The move that makes this work: **occurrences carry no path; a path is attached only
at node-build time.** Parsing a blob's AST yields facts that are true of that blob's
*content* regardless of where it happens to live on disk right now —
`qualified_name` (the `.`-joined scope chain, e.g. `Auth.validateToken`),
`signature`/`signature_hash` (a normalized, hashed parameter list, degrading to
arity + names for dynamically-typed languages), and `parent_qualified_name` (the
enclosing scope, itself path-free, letting node-build reconstruct `contains` edges
without ever storing a path on the occurrence). None of this needs a path to be
computed or to be true. It is extracted exactly once per `blob_hash` — `storeStructuralRefs()`
enforces this with a `SELECT 1 ... WHERE blob_hash=? LIMIT 1` dedup check
(`blobStore.ts:399-418`) before writing, mirroring the embedding dedup discipline
exactly.

The graph node's `node_key` is then produced later, by joining an occurrence's
`blob_hash` against `paths` (`src/core/graph/nodeKeys.ts:1-22`):

```
fileNodeKey(path)                                → "file:<path>"
symbolNodeKey(path, qualifiedName, sigHash)      → "symbol:<path>#<qualifiedName>#<sigHash>"
externalNodeKey(name)                            → "external:<name>"
```

If one blob maps to two paths, this correctly fans out to two symbol nodes — no
arbitrary "pick a path" decision, no re-parse per path (the parse already happened
once, at the occurrence level). **Critically, the symbol key is not
content-addressed** — same `(path, qualified_name, signature_hash)` survives an
unrelated edit elsewhere in the file, even though the file's blob hash changes on
every edit. That's the entire point: content-addressing gives you *what*, this key
gives you *identity over time*, and neither can substitute for the other.

**Why isn't the graph node itself just the stable identity, skipping the occurrence
layer?** Because building it requires a join across `paths` and (for edge
resolution) other blobs' occurrences — it is a derived artifact, like
`blob_clusters` or `module_embeddings`, not a raw fact. Occurrences are the raw
facts: parse-once, blob-intrinsic, immutable, mirroring the embeddings table's own
discipline. Graph nodes/edges are then rebuilt from occurrences the same way a
k-means snapshot is rebuilt from embeddings — recomputed wholesale by `gitsema
graph build`, never incrementally patched. **Every edge additionally carries
`first_seen_commit`/`last_seen_commit`/`observed_count`**, reusing the exact
`blob_commits` mechanism that already powers `first-seen` — temporal provenance on
graph edges comes for free from the same content-addressed backbone, no separate
extraction needed.

Edge resolution (site → definition) is confidence-tiered, not binary
(`docs/knowledge-graph.md` §4): same-file ≈1.0, imported ≈0.9, project-wide-unique
≈0.6, ambiguous ≈0.3 (nearest path/module distance), unresolved → an `external`
node with confidence 0. This is a deliberate accept-imperfection design — cross-file
call resolution for dynamically-typed/loosely-typed languages cannot be sound, so
the schema records a confidence instead of silently guessing or hard-failing.

**Port implication:** if/when the Kotlin port builds any structural graph (see
Decision A, §10), this two-level split is not optional scaffolding — it is *why*
the graph can coexist with blob-first immutability at all, and should be preserved
exactly, including the "occurrence: parse-once, path-free" / "node: rebuild wholesale,
path-bearing" boundary.

---

## 2. Chunking

Three strategies, dispatched from `ChunkStrategy = 'file' | 'function' | 'fixed'`
(`src/core/chunking/chunker.ts`). Every chunker implements `chunk(content, path):
Chunk[]`, where a `Chunk` carries 1-indexed `startLine`/`endLine`, `content`, and —
only from the function chunker — the four Phase-105 identity fields from §1.2.

### 2.1 File chunker (default, `--chunker file`)

Trivial: one `Chunk` spanning the whole file (`fileChunker.ts:7-12`). No boundary
logic. This is why `speed`/`balanced` profiles both default to it (§3.2) — it's the
cheapest possible embedding unit (one embed call per blob).

### 2.2 Fixed chunker

`DEFAULT_WINDOW_SIZE = 1500`, `DEFAULT_OVERLAP = 200` characters
(`fixedChunker.ts:3-4`), overridable via `--window-size`/`--overlap`. Constructor
clamps `overlap = min(overlap, windowSize - 1)` to guarantee forward progress.

Algorithm, operating on the file's line array, **never splitting mid-line**:
1. From the current start line, accumulate lines (each counted as `length + 1` for
   the trailing newline) until the running character count reaches `windowSize` —
   that's one chunk, boundary snapped to a line end.
2. To compute the next window's start: `stepTarget = charCount - overlap`; walk
   forward from the current start accumulating line lengths until reaching
   `stepTarget`; the landing line is the next window's start (this is how overlap
   is achieved — the next window re-includes roughly the trailing `overlap`
   characters of the previous one, rounded up to whole lines).
3. Forward-progress guard: `startLine = max(nextStart, startLine + 1)` — the window
   always advances by at least one line, even if overlap arithmetic would otherwise
   stall it.

No language awareness. **No documented rationale exists in the codebase for why
1500/200 specifically** (not 1000/100, not 2000/300) — this is a reasonable,
unexplained default, not a benchmarked one. The Kotlin port should treat it as a
starting point to validate against real embedding-model context windows, not as a
number with hidden meaning.

### 2.3 Function chunker — tree-sitter, with a regex fallback that is not the primary path

`functionChunker.ts` (887 lines) is genuinely **tree-sitter-driven**, not
regex-based as the shorter doc comment in `chunker.ts` implies — the regex path is
an explicit degrade-path, used when tree-sitter is unavailable or unsupported for
the language, not the everyday mechanism.

**Loading** (`functionChunker.ts:24-126`): a dynamic CJS `require('tree-sitter')`
probed once per process (`tsAvailable` cached), then per-language native grammar
packages lazily `require()`d: `tree-sitter-typescript` (both `typescript` and
`tsx` export keys), `tree-sitter-javascript`, `tree-sitter-python`,
`tree-sitter-go`, `tree-sitter-rust`. **Java, C#, Kotlin, and Scala have no
tree-sitter grammar wired in this codebase at all** — they always hit the regex
fallback, unconditionally. Language is picked purely by file extension.

**Two separate AST walks reuse the same parse:**
- **Top-level declaration extraction** (`extractDeclarationsWithTreeSitter`,
  lines 329-353): walks only `rootNode.namedChildren`, matching a per-language
  whitelist of node types (`isTopLevelDecl`) — TS: `export_statement |
  function_declaration | class_declaration | lexical_declaration`; Python:
  `function_definition | decorated_definition | class_definition`; similar for
  Go/Rust. This produces the chunk boundaries.
- **Recursive scope-stack walk** (`extractSymbolMetadata`/`visitDeclaration`,
  lines 476-624, TS/TSX/JS/Python only) computes the path-free stable identity
  from §1.2 for *every* nested symbol (class methods, field-assigned arrow
  functions), not just top-level ones — `qualifiedName` via scope-chain join,
  `signature`/`signatureHash` via per-parameter normalization
  (`describeParam()`, handling TS type annotations, Python typed/default/splat
  params, JS default/destructured/rest params) then `sha1(signature).slice(0,12)`,
  and `parentQualifiedName` for the enclosing scope. Only the subset with
  `parentQualifiedName === undefined` (i.e. top-level) gets merged onto chunk
  boundaries by matching start lines; the full recursive result also feeds
  `structuralRefs.ts` for nested-symbol identity in the graph layer.

**Regex fallback** (lines 629-756), used when tree-sitter/grammar is unavailable
**or** returns an empty array (empty is treated as "might just mean no grammar
installed," not "genuinely no declarations," so it degrades rather than trusting a
possibly-false negative): one single-line regex per language family —
`PYTHON_SPLIT_RE`, `GO_SPLIT_RE`, `RUST_SPLIT_RE`, `TS_SPLIT_RE`, and
`JAVA_SPLIT_RE` (covering Java/C#/Kotlin/Scala's modifier keywords before a method
signature) — applied line-by-line. Python decorator lines immediately preceding a
matched `def`/`class` are pulled backward into the same declaration so decorators
stay attached.

**Minimum-size merge:** `MIN_CHUNK_LINES = 5` — any resulting chunk under 5 lines
is merged into its predecessor "to avoid tiny, low-value embeddings"
(`functionChunker.ts:766, 854-873`); if the absorbed chunk carried real symbol
metadata and the predecessor was a symbol-less preamble, the metadata propagates
onto the merged chunk so it isn't lost.

**`structuralRefs.ts` reuses this exact plumbing** — it imports `detectLanguage`,
`getGrammar`, `TS_JS_LANGS` directly from `functionChunker.ts` rather than
re-implementing parsing, sharing the same lazy-load/optional-dependency contract.
Unlike the function chunker, **it has no regex fallback at all**: if tree-sitter or
the language isn't TS/TSX/JS/Python, it returns `[]`, never throws. This is the
crux of the tree-sitter native-dependency question resolved in Decision A (§10.A).

### 2.4 The context-limit fallback chain

Implemented in the **indexer**, not the chunkers themselves (`src/core/indexing/indexer.ts:917-1041`)
— the chunkers are pure, stateless splitters; retry/fallback orchestration is a
pipeline concern. Only active on the whole-file (`--chunker file`) embedding path.

**Trigger:** the whole-file `embed()` call throws and the error message matches
`/context|input length|exceeds the context/i` — a heuristic string-sniff of
provider error text, not a structured error type or an explicit size check. This
is fragile by construction (see Decision C, §11) and depends entirely on the
embedding backend phrasing its error one particular way.

**Chain, exact:**
1. **Whole file** (the default path) fails on context length.
2. **Function chunker** (`createChunker('function', {})`) — the blob is stored once,
   then each function-level chunk embedded individually.
3. If an *individual* function-chunk still exceeds context → **fixed windows, sizes
   tried in order `[1500, 800]`**, `overlap: 200` **hardcoded at this call site**
   (not derived from any CLI `--overlap` value — `indexer.ts:966`, numerically
   identical to `fixedChunker.ts`'s own defaults but a separate literal). Each size
   is tried in full; if *every* sub-chunk at that size embeds successfully, that
   size wins and the loop stops; otherwise the next (smaller) size is tried.
4. If 800-char windows still fail for a given sub-chunk, that sub-chunk alone is
   marked failed (`stats.failed++`, `stats.embedFailed++`) — no further shrinking,
   and indexing continues for the blob's other sub-chunks and for other blobs.

Each successfully embedded fallback unit (function-chunk or fixed sub-chunk) is
stored as a `chunk`-kind vector row, not a `file`-kind one — the blob ends up with
per-chunk embeddings instead of one whole-file embedding, and downstream ranking
treats it accordingly (dedup-to-best-score-per-blob happens at query time, see
§4.1).

---

## 3. Embedding

### 3.1 Provider seam (must be injected, per constraint 2 — confirmed correct)

`EmbeddingProvider` (`provider.ts:3-8`) is minimal by design: `embed(text)`,
optional `embedBatch(texts)`, readonly `dimensions`/`model`. The library never
loads a model itself — every concrete implementation (`OllamaProvider`,
`HttpProvider`, `EmbedeerProvider`) is a thin HTTP/process client, injected at
construction. This is directly portable as the Kotlin `EmbeddingProvider`
`suspend fun embed(texts: List<String>): List<FloatArray>` interface specified in
the porting brief — no design work needed here, just translation.

`RoutingProvider` (`router.ts`) is not itself a provider; it's a dispatcher over a
`(textProvider, codeProvider)` pair, routing by `getFileCategory()`
(`fileType.ts:11-40` — extension lists for `code` vs. `text` vs. `other`, `other`
falls back to the text provider). Queries always use the text provider ("queries
are natural-language prose," `router.ts:65-68`) — this matches CLAUDE.md's "the
code provider is not skipped" rule for dual-model search exactly. `PrefixedProvider`
wraps a provider to prepend an instruction string (e.g. `"search_document: "` /
`"search_query: "` for instruction-tuned models like nomic-embed-text-v1) before
every call — `model`/`dimensions` pass through unchanged so DB provenance stays
stable under the wrapper.

### 3.2 Batching and the speed/balanced/quality profiles

**Corrected values** (`src/core/indexing/adaptiveTuning.ts:34-50`, Phase 63):

| Profile | Concurrency | Embed batch size | Chunker | Rationale (as stated) |
|---|---|---|---|---|
| `speed` | 8 | 32 | `file` | More parallelism, bigger batches, coarsest chunking — maximize throughput |
| `balanced` | 4 | 16 | `file` | The default shape, moderate on every axis |
| `quality` | 2 | 4 | `function` | Less parallelism (smaller batches embed with more per-item attention/lower risk of provider-side truncation), function-level chunking for finer retrieval granularity |

**No inline comment or doc gives a benchmarked reason for these exact numbers** —
the module header only states the qualitative intent above. Treat these as
reasonable starting defaults for the Kotlin port to re-tune against real
on-device embedding-provider latency, not calibrated constants to preserve
byte-for-byte.

**General `p-limit` concurrency default is 4** (`indexer.ts:271`), independent of
any profile — this is what CLAUDE.md's design constraint 2 ("don't remove this
throttle") refers to. It is a pure caller-side concurrency cap (in Kotlin: a
bounded `Semaphore` or a fixed-size coroutine dispatcher), not tied to profile
selection.

**`resolveEmbedBatchSize()`** (`adaptiveTuning.ts:76-87`) resolution order: explicit
`--embed-batch-size` wins; else if the provider implements batch embedding, use
`profileBatchSize ?? 16`; else `1` (no batching). This is where the CLAUDE.md
default of `--embed-batch-size 1` comes from in the no-profile, no-override case.

An `AdaptiveBatchController` class exists (`adaptiveTuning.ts:109-166`, dynamically
widening/narrowing batch size by observed per-item latency and consecutive-error
counts) but **is not actually instantiated anywhere in `indexer.ts`** — confirmed
dead infrastructure, not a shipped behavior. Do not port it as "the real batching
logic"; the three static profiles above are what's actually live.

**Critically for Aidos:** the host supplies the `EmbeddingProvider` and owns
admission control (the porting brief's global admission queue, because one loaded
LLM can saturate a phone). Batch size and concurrency in this library are *requests*
to that provider, not guarantees — the Kotlin seam should treat `embedBatch()`
failures/backpressure from the host as first-class, not assume the provider is
always immediately available the way a local Ollama daemon or hosted HTTP API is.

### 3.3 Normalization — none at rest

No L2/unit-vector normalization is applied before storage anywhere in the TS
embedding subsystem (confirmed by reading every provider/wrapper file). Cosine
similarity is computed on **raw stored vectors at query time**:
`cosineSimilarity(a,b) = dot(a,b) / (|a| * |b|)`, plain `for` loop, no SIMD/BLAS
(`vectorSearch.ts:101-112`). A precomputed-magnitude variant avoids recomputing the
(fixed) query vector's own magnitude per candidate, but this is a query-time
optimization, not evidence of storage-time normalization. This directly matches
CLAUDE.md's "immutable embeddings" constraint — normalizing at read time keeps
stored vectors exactly as the provider returned them, so nothing about a stored
row is derived from a decision made after it was written. **Port as-is**: store
raw provider output, normalize only in the scoring hot path if at all.

### 3.4 int8 quantization

Per-vector, **asymmetric** min/max scalar quantization (`quantize.ts`, full
algorithm):

```
scale = (max(v) - min(v)) or 1        // guards degenerate all-equal vectors
data[i]  = round((v[i] - min) / scale) - 128     // → Int8 range
dequant[i] = (data[i] + 128) * scale + min
```

`min`/`scale` are stored per-vector alongside the quantized bytes (`quant_min REAL`,
`quant_scale REAL` columns, schema v11/Phase 36) — **not** a global or per-model
scale, so every quantized row carries its own dequantization parameters. This
matters for the port: a flat-file vector store (§9.3) must keep `min`/`scale`
adjacent to each vector's bytes, not factor them out.

**"4× smaller" is exact arithmetic** (Int8 = 1 byte/dim vs. Float32 = 4
bytes/dim on the raw vector, ignoring the small fixed per-vector `min`/`scale`
overhead) — not something that needs a citation. **"~1% recall loss" is not
independently documented anywhere** in source or docs; the closest evidence is
`tests/quantize.test.ts`, which asserts round-trip cosine similarity `> 0.98` after
quantize→dequantize (i.e. the test's own bar tolerates up to ~2% degradation, not
1%). Treat "~1%" as an optimistic rounding of a 2%-bound test assertion, not a
measured production number. The Kotlin port should re-derive its own recall-vs-size
tradeoff empirically once real on-device embedding models are in the loop, and
quantization should be the **default**, not opt-in, given constraint 1 — the TS
codebase treats it as an opt-in `--quantize` flag because server disk/RAM is cheap;
a phone doesn't have that luxury (see Decision C, §11).

### 3.5 Model-change handling (`indexing/provenance.ts`)

Each embed configuration — `{provider, model, codeModel, dimensions, chunker,
windowSize, overlap}` — is hashed deterministically (`computeConfigHash()`,
sorted-key SHA-256) and recorded in `embed_config`, `INSERT OR IGNORE` +
`last_used_at` refresh on every use.

**The design explicitly allows multiple coexisting models in one index** — because
embeddings are keyed `(blob_hash, model)`, re-indexing under a *different* model
name is normal, safe, and additive; nothing needs to be cleared. **Incompatibility
is flagged only when the same model name reappears with a different dimension
count** (`checkConfigCompatibility()`) — that specific case would silently corrupt
cosine comparisons within that model's own result set, since search assumes every
row under a given model name is the same dimensionality. This is the one case that
hard-errors (`gitsema index start` refuses) unless `--allow-mixed` is passed, or the
operator runs `gitsema index clear-model <model>` first.

**Port implication:** the Kotlin `EmbeddingProvider.modelId` should feed the same
compatibility check — reject silently-mismatched dimensions for a given model id,
allow different model ids to coexist freely. This is cheap correctness, not a
design tradeoff, and should not be skipped to save time.

### 3.6 Locked-model-set (`docs/locked-model-set-plan.md`, Phase 128) — server concept, worth understanding but not porting directly

This design exists for `gitsema tools serve` multi-tenant deployments, and its
origin is instructive: the feature-idea that spawned it assumed a pre-existing
"many users pick different models and corrupt a shared index" problem — but
research for the plan found the server's embedding provider was, at the time, a
**single process-wide singleton with no per-request override at all**. The real
contribution of Phase 128 was building the capability to offer multiple named
profiles from one server process (`embedding/profiles.ts`,
`buildProfileProviderMap()`) *before* any curation/locking made sense — you can't
lock a choice that doesn't exist yet.

`repos.profile_name` (schema v32) pins a repo to exactly one profile at first
index, permanently — disabling a profile later blocks *new* pins, but never breaks
already-pinned repos' reads, consistent with the immutable-embeddings constraint.

**Not directly relevant to the phone library** (there is no multi-tenant server on
a phone), but the underlying invariant it enforces — one repo, one embed
config, pinned for the repo's lifetime — is exactly what §3.5's
`checkConfigCompatibility()` already gives you locally. Nothing new to build; noted
here so the Kotlin port doesn't reinvent profile-pinning under a different name
when it's really the same mechanism at smaller scope. `embedding/profiles.ts`'s
"profile" (a named model config) should not be confused with `adaptiveTuning.ts`'s
"profile" (speed/balanced/quality) — the TS codebase itself has this naming
collision; the Kotlin port's API should not repeat it.

---

## 4. Retrieval and ranking

### 4.1 Vector search — current TS approach (must change for a phone; see §9)

`src/core/search/analysis/vectorSearch.ts` (741 lines) builds a **candidate pool**
of `CandidateRow`s pulled from `embeddings` (whole-file) and optionally
`chunk_embeddings`/`symbol_embeddings`/`module_embeddings`, each row carrying its
vector as a raw `Buffer` — **no SQL-side similarity computation, no ANN index by
default**; every row in the pool is pulled into process memory as bytes before any
scoring happens.

Row caps exist purely to bound memory, not for relevance: `FILE_CAP` (default
50,000, env `GITSEMA_FILE_CAP`), `CHUNK_CAP`/`SYMBOL_CAP` (25,000 each),
`MODULE_CAP` (5,000). When no explicit filter narrows the query, the base file-level
query uses `ORDER BY RANDOM() LIMIT 50000` — **the candidate pool is a random
subsample when the table exceeds the cap, not the full table.** A second
reservoir-sampling stage (`reservoirSample`, classic Algorithm R) cuts the filtered
pool down to `AUTO_CANDIDATE_LIMIT` (50,000) again if still oversized, unless the
caller passed an explicit `--early-cut`.

**Scoring is a full linear scan with no top-k heap**: every row in the (already
capped) `scoringPool` is deserialized (dequantizing if needed), cosine-scored, and
pushed to an array; the array is fully sorted (`Array.sort`, O(n log n)); a
best-score-per-blob dedup pass follows (chunk/symbol/module rows can multiply-map
to one blob); the deduped values are **sorted again**; then sliced to `topK`. There
is no incremental bounded structure anywhere in this path.

**Memory math at 50,000 blobs, 768-dim float32:** ~150 MB in raw vector bytes alone
for whole-file embeddings, before JS array/object boxing overhead (commonly 3-5×
in Node) and before chunk/symbol embeddings are added on top. This is the exact
thing constraint 1 calls out as unacceptable next to a loaded LLM on a phone.

An ANN path exists (`vectorSearchWithAnn()`, opt-in via `--build-vss` or
auto-triggered above `GITSEMA_VSS_THRESHOLD`, default 50,000 rows) using the
`usearch` npm package against a prebuilt HNSW index file. **Even this path only
prunes the candidate set** — the shortlist it returns is re-scored by the exact
same linear-scan cosine code above, not accepted as final ranking. `usearch` is
native (forbidden per constraint 2); its role here (candidate pruning before exact
re-score, not final-answer ANN) is useful context for §9's redesign even though
the library itself cannot come along.

### 4.2 Three-signal ranking

**Not in `ranking.ts`** despite the name — that file is pure presentation
(grouping, formatting, `groupResults`). The actual blend lives in
`vectorSearch.ts:272-277, 510-515`:

```
wv = weightVector   ?? 0.7
wr = weightRecency  ?? 0.2
wp = weightPath     ?? 0.1
score = (wv * cosine + wr * recency + wp * pathScore) / (wv + wr + wp)
```

Confirmed exactly matching CLAUDE.md's 0.7/0.2/0.1. This weighted path only
activates when at least one `--weight-*` flag is passed; it is **mutually
exclusive** with a separate two-signal `--recent`/`--alpha` blend
(`score = alpha*cosine + (1-alpha)*recency`, default `alpha=0.8`) — a query uses
plain cosine, the two-signal blend, or the three-signal blend, never an ambiguous
combination.

**No tuning rationale exists anywhere** — not in code comments, not in any
`docs/review*.md`, not in `docs/features.md`. Every hit for these numbers is either
the constant's own definition or a CLI flag's default-value description. Treat
0.7/0.2/0.1 (and 0.3 for BM25 below) as **inherited, unvalidated defaults**, not
empirically derived weights — a very different corpus scale (phone-local single
repo vs. server-scale multi-repo) is a reasonable trigger to re-tune them with real
evaluation (`gitsema eval`'s precision@k/recall@k/MRR harness is the right tool for
this, and should be ported early enough to validate whatever defaults the Kotlin
port ships).

**Recency formula — linear min-max, not decay** (`timeSearch.ts:115-132`):
```
range = maxTimestamp - minTimestamp   // across the CURRENT candidate pool
recency(blob) = (blob.timestamp - minTimestamp) / range     // 0 if range == 0 → 1.0
```
The oldest blob *in the pool being searched* always scores 0, the newest always
scores 1 — recency is relative to what's being searched, not an absolute decay
curve from "now." There is no half-life or decay constant anywhere in the
codebase. `firstSeenMap` (blob → earliest commit timestamp, batched 500/query)
feeds this; the identical formula backs both the two-signal and three-signal
blends — there is only one recency implementation in the codebase.

**Path-relevance formula** (`vectorSearch.ts:149-155`), pure substring match:
```
tokens = query.toLowerCase().split(/\W+/).filter(Boolean)
score(path) = count(t in tokens where path.toLowerCase().includes(t)) / tokens.length
```
No stemming, no directory-proximity weighting, no fuzzy matching. When a blob maps
to multiple paths, the best-matching path's score wins.

### 4.3 Hybrid search (BM25 fusion)

`hybridSearch.ts` (108 lines): over-fetches `max(topK*3, 50)` candidates from both
vector search and FTS (so there's enough material to re-rank after fusion);
degrades silently to vector-only if no FTS store is configured, or if the FTS
query throws.

**Normalization is min-max on each side independently, not Reciprocal Rank
Fusion.** SQLite's `bm25()` is lower-is-better, so BM25 scores are negated then
min-max scaled to `[0,1]`; ties (`range === 0`) are forced to the neutral midpoint
`0.5` — an explicit, commented fix (§11.2 in the source) because forcing ties to
`1.0` previously "inflated hybrid scores beyond the intended weight distribution."
The vector side is min-max scaled the same way, but ties there **are** forced to
`1.0` (asymmetric from the BM25 case, unexplained in source — worth normalizing to
one consistent convention in the Kotlin port rather than preserving the
inconsistency).

**Fusion:** `hybridScore = (1 - bm25Weight) * normVec + bm25Weight * normBm25`,
default `bm25Weight = 0.3` (confirms CLAUDE.md). Union of both candidate hash sets;
blobs present only in BM25 results get their `paths` resolved separately so they
still render.

**FTS5 mechanics:** `blob_fts` is a Porter-stemmed, ASCII-tokenized virtual table
(`tokenize='porter ascii'`). Queries wrap each whitespace-split token in double
quotes (`"token1" "token2" ...`), which FTS5 interprets as an implicit AND of
phrase terms. This is nearly free with SQLite (constraint 6's rationale) and works
before any embedding model exists at all.

### 4.4 Boolean query syntax

Deliberately minimal, a single regex split rather than a real parser
(`booleanSearch.ts`, 36 lines):
```
AND: /^(.+?)\s+AND\s+(.+)$/i     — checked first
OR:  /^(.+?)\s+OR\s+(.+)$/i      — checked only if AND doesn't match
```
**No NOT, no parentheses, no grouping, no precedence.** A query containing both
operators only recognizes whichever is checked first (AND), splitting into exactly
two parts; the right-hand side is never recursively parsed as boolean — it becomes
one literal search string. Merge semantics: `mergeOr` is a max-score union over a
`Map<blobHash, result>`; `mergeAnd` is an intersection combined via **harmonic
mean** (`2*ra*rb / (ra+rb+ε)`), not arithmetic mean — this rewards results that
score well on *both* sides rather than one side compensating for a weak other.
Separate CLI `--or`/`--and` flags run additional searches merged the same way,
independent of the inline `A AND B` syntax.

### 4.5 Two caches, different purposes — worth keeping distinct in the port

**Query embedding cache** (`embedding/queryCache.ts`): caches only the **embedding
vector** for a `(query_text, model)` pair, never search results — avoids
re-invoking the embedding provider for repeated identical queries. TTL 7 days
(`DEFAULT_TTL_MS`), max 10,000 entries, LRU-by-`cached_at` eviction once over the
cap; writes are upsert-refresh (`ON CONFLICT DO UPDATE ... cached_at = excluded`),
so repeat queries keep resetting their own TTL clock. This is a genuinely useful,
low-cost win to port — a phone-local model call is exactly the kind of cost worth
avoiding on a repeat query.

**Result cache** (`search/analysis/resultCache.ts`): caches full `SearchResult[]`
arrays, keyed by a composite fingerprint of query text/embedding **and every
search option** (weights, filters, branch, model, etc.), **in-process only** (a
plain `Map`, not persisted, lost on restart). TTL 60s, max 256 entries, FIFO
eviction. Invalidation is a generation counter (`indexVersion`) baked into every
cache key's prefix — bumping it makes every prior key permanently unmatchable
without deleting entries individually, relying on writers remembering to bump it
after any index mutation.

**Port judgment call:** the query-embedding cache earns its place (§3.5's
provenance discipline makes it trivially correct, and phone-side embedding calls
are the expensive part). The in-process result cache is a much weaker fit for a
phone: a 60-second TTL tuned for a long-lived server process buys little when the
host process can be backgrounded/killed at any moment (constraint 3), and losing it
on every process death means it rarely gets to pay for its own complexity. Treat it
as optional/deferred, not a Tier 1 requirement — see Decision C, §11.

---

## 5. The ~15+ analysis capabilities

CLAUDE.md groups these as temporal / concept / ownership / quality-risk / merge /
clustering. All figures below assume a 50,000-blob repo with 768-dim float32
embeddings (~3 KB/vector raw; ~150 MB for the whole `embeddings` table before JS
overhead). **Safety verdicts are for the *current* TS implementation** — most of
the "unsafe" verdicts trace back to the same shared primitive
(`vectorSearch.ts`'s full-materialize scan, §4.1) or an equivalent unbounded
full-table load, which means a redesigned Kotlin vector-search core (§9) fixes most
of them *for free*, without touching the capability's own logic. Capabilities
called out as needing their **own** independent redesign (not just inheriting the
fix) are marked accordingly.

### Temporal

**`evolution` (file-evolution)** — how has one file's meaning drifted, version to
version? Loads only that file's own blob history (`paths` → `blob_commits` join,
sorted by first-seen), walks it once computing `1 - cosine(prev, cur)` per step.
Bounded by *one file's* version count, not repo size. **SAFE.**

**`changePoints`, file variant** — thin wrapper over `evolution`, same bound.
**SAFE.**

**`changePoints`, concept-wide variant** — at which commits did a whole-repo
*topic* shift most sharply? Loads the entire `embeddings` table, scores every blob
against the query once, then re-computes a score-weighted centroid of the top-50
*visible-as-of* blobs once per distinct commit in range (could be thousands).
O(repo size) memory, O(commits × topK) compute. **UNSAFE as-is**; would need the
embeddings scan capped/streamed and the commit sampling bounded (e.g. `maxCommits`)
independent of the vector-search redesign, since this isn't calling
`vectorSearch()` — it has its own full-table load.

**`healthTimeline`** — codebase size/churn/dead-weight trend by time bucket. Pure
SQL aggregation (`COUNT(DISTINCT ...)` per bucket window) — **no embeddings touched
at all**. **SAFE, cheapest in the set alongside `experts`.**

### Concept

**`conceptLifecycle`** — born/growing/mature/declining/dead classification over
history. 10 evenly-spaced checkpoints, each capped at `LIMIT 2000` embedding rows
(explicit, deliberate cap, not O(repo)). **SAFE**, though the `LIMIT 2000` is a
silent, non-representative truncation (whatever SQLite returns first) — the Kotlin
port should replace it with a deliberate sample or a true `COUNT` if correctness
matters more than matching today's approximate behavior.

**`deadConcepts`** — deleted-but-still-relevant content. Loads the **entire**
`embeddings` table to partition HEAD vs. non-HEAD blobs and compute a HEAD
centroid. O(repo size) memory. **UNSAFE as-is**, and this is a genuine two-pass
redesign (compute the HEAD centroid via a bounded/streamed pass first, then
stream-score dead blobs against it) — not something the vector-search redesign
alone fixes, since it never calls `vectorSearch()`.

**`semanticBisect`** — binary search over commit history for where a concept
diverged from a good baseline. True `O(log commits-in-range)` search, each step
capped at `LIMIT 5000` embedding rows. **SAFE**, the cheapest of the diff-style
tools by deliberate design (a real algorithmic bound, not just a row cap).

**`semanticDiff`** — gained/lost/stable concepts between two refs. Needs the
*union* of blobs live at either ref — for refs close together this is small, for
HEAD-vs-first-commit it can approach the full blob set. **RISKY**, scales with ref
distance, not a hard cap.

**`commitSearch`** / **`cherryPick`** — commit-message similarity. Scans
`commit_embeddings` (one row per **commit**, not per blob) — typically far smaller
than the blob table. **SAFE** in most repos; degrades only if commit count is
unusually large relative to blob count.

### Ownership

**`experts`** — top contributors by semantic area. Pure SQL `GROUP BY` over
`blob_commits ⋈ commits`, plus a small per-author follow-up query against
pre-computed `cluster_assignments`. No vectors loaded at all. **SAFE, cheapest
alongside `healthTimeline`.**

**`authorSearch`** — author attribution for a concept. **SAFE if called with
pre-filtered candidate blobs** (e.g. from a prior hybrid/BM25 pass); **RISKY/UNSAFE
if it must fall back to its own full `embeddings` scan** when no candidates are
supplied. The Kotlin port should make pre-filtered candidates the *only* supported
call shape, not an optional fast path.

**`contributorProfile`** — an author's semantic centroid. Two full-corpus passes:
gathering the author's own blob vectors (bounded by their commit count) plus an
implicit full-corpus scan inside the final `vectorSearch()` call to find nearest
neighbors to that centroid. **UNSAFE as-is**, but the second pass inherits the §9
redesign for free — only the first (author-history gathering) is independently
bounded already.

**`ownershipHeatmap`** — ownership trend (gaining/fading/stable) per author for a
concept. Dominated entirely by an underlying `vectorSearch()` call (wide candidate
pool, `topK*20`); post-processing over that bounded set is cheap. **Inherits the §9
fix directly** — no independent redesign needed.

### Quality / risk

**`debtScoring`** — isolation × age × change-frequency. Age/frequency come from one
cheap SQL pass over all blobs. **Isolation** either uses a prebuilt HNSW index (native,
forbidden — see §9) or falls back to an explicit **O(N²)** all-pairs cosine scan
holding every vector in memory simultaneously. **UNSAFE as-is, and needs its own
solution independent of §9's redesign** — this is the strongest argument in the
whole analysis-capability set for *some* form of on-device ANN/bucketing (§9.3),
because there is no cap-and-stream trick that makes an inherently-pairwise
computation cheap; it needs the candidate space genuinely pruned.

**`docGap`** — code files with weak similarity to any doc file. Holds all
doc-blob vectors in memory (usually a small fraction of the repo) and streams code
blobs against them in batches of 500. **Better than full O(N²)** since one side is
typically small; **RISKY, not UNSAFE**, degrading toward the debt-scoring case only
if the repo has thousands of prose files.

**`refactorCandidates`** — near-duplicate pairs for refactoring. **The only
capability with a built-in row cap regardless of repo size** — `LIMIT 2000`
candidate rows, O(n²) pairwise scan bounded to ≤2000² comparisons, with an
early-exit once enough pairs are found. **SAFE by construction**, the most
naturally phone-ready of the pairwise tools, at the cost of an arbitrary
(unstratified) 2000-row sample on large repos.

**`securityScan`** — semantic match against 6 fixed vulnerability-pattern queries
plus regex heuristics on top hits. Each pattern runs its own full `vectorSearch()`
call — **6× the base scan cost**, with no evidence the embedding table is
loaded/cached once and reused across patterns. **Inherits the §9 fix per-call**, but
the Kotlin port should additionally hoist the embedding load out of the per-pattern
loop rather than relying on the redesign alone to absorb a 6× multiplier.

**`impact`** — cross-module coupling for a changed file. Full `embeddings` scan
(worse with chunk/symbol modes enabled), plus an O(all-paths) fallback when exact
path lookup misses. **UNSAFE as-is; inherits the §9 fix** for the embedding-scan
part, but the path-lookup fallback is a separate, smaller bounded-cost fix (index
the fallback lookup, or drop suffix matching in favor of an indexed query).

**`semanticBlame`** — per-block nearest-neighbor attribution. Loads the entire
embeddings/symbol-embeddings table up front, then does one full linear scan **per
chunk** in the target file — O(chunks × corpus). **UNSAFE as-is; the worst
multiplier in the set** (chunk count × full corpus) even after inheriting §9's
per-scan fix, since §9 bounds one scan, not this capability's repeated-scan
pattern — needs its own care to share the loaded/streamed candidate structure
across all chunks in one file rather than rebuilding it per chunk.

**`codeReview`** — historical analogues + regression-risk for a diff. Up to 2 full
`vectorSearch()` calls **per changed hunk**, with no caching across hunks.
**Inherits §9's fix per call**, but for a multi-file diff the Kotlin port should
still hoist the embedding load/index out of the per-hunk loop.

**`regressionGate`** — CI base/head drift per query. 2 `vectorSearch()` calls per
configured query. **Inherits §9's fix directly**, scales linearly and predictably
with query count.

### Merge

**`mergeAudit`** (collision detection) — semantic overlap between two branches'
exclusive blob sets. Bounded by branch-diff size (typically tens–hundreds of
blobs), O(|A|×|B|) over that small set. **SAFE.**

**`mergeAudit`** (merge-impact / preview) — runs full k-means clustering twice
(before/after sets, each potentially approaching total blob count). **UNSAFE**,
inherits whatever fix `clustering` itself needs (below) — not independently
solvable without fixing clustering first.

**`branchSummary`** — branch semantic summary + per-file drift vs. base. Bounded
entirely by branch-exclusive blob/path count; per-path drift reuses `evolution`'s
already-bounded single-file walk. **SAFE.**

### Clustering

**`clustering`** (k-means, default `k=8`, `maxIterations=20` with early-exit on
stable assignment, k-means++ weighted-distance init) — reuses stored embeddings,
**never re-embeds**, but holds every clustered vector as a JS `number[][]`
(float64, 8 bytes/dim) simultaneously in memory — at 50,000 blobs this is
~300 MB+ just for the vector arrays, **before** k-means working memory. Timeline/
change-point variants repeat this per sampled commit (partially amortized by
warm-starting centroids across steps). **UNSAFE as-is, and the single biggest
memory risk in the whole capability set** — and, notably, **not** a case that
inherits the §9 vector-search redesign, because clustering doesn't go through
`vectorSearch()` at all; it does its own full materialization. This needs an
independent fix: streaming/mini-batch k-means (assign-and-accumulate centroids
without holding every vector at once), and, trivially, storing vectors as
primitive `FloatArray`/`ByteArray` in Kotlin instead of the JS `number[][]`
equivalent — which alone recovers 2–8× the memory this specific implementation
wastes purely from language representation, independent of any algorithmic change
(see Decision C, §11).

### Summary table

| Capability | Verdict (TS today) | Fixed by §9 redesign alone? |
|---|---|---|
| evolution (file), changePoints (file), semanticBisect, conceptLifecycle, commitSearch, cherryPick, experts, healthTimeline, branchSummary, mergeAudit (collisions), refactorCandidates | **SAFE** | n/a — already bounded |
| authorSearch (pre-filtered only), ownershipHeatmap, regressionGate | SAFE/inherits fix | **Yes** |
| semanticDiff, docGap, contributorProfile (2nd pass) | RISKY | Partially |
| changePoints (concept), deadConcepts, impact, codeReview, securityScan | UNSAFE | Yes, but needs load hoisted out of loops too |
| semanticBlame | UNSAFE | No — needs shared-scan-across-chunks fix |
| debtScoring | UNSAFE | No — needs genuine ANN/pruning, not just streaming |
| clustering (+ mergeAudit's impact half) | **UNSAFE, worst case** | No — independent streaming/mini-batch redesign required |

---

## 6. Storage

### 6.1 Four interfaces, not three

`src/core/storage/types.ts` defines **four** store interfaces (the porting brief's
three plus a fourth, `GraphStore`, added Phase 107 for the knowledge graph):

- **`MetadataStore`** — relational facts always present: blob/path/commit
  bookkeeping, dedup checks, provenance, structural-ref storage. Always-on, never
  optional.
- **`VectorStore`** — `search()`, `upsert(kind, items)`, `delete()` over
  `VectorKind = 'file'|'chunk'|'symbol'|'module'|'commit'`, keyed by each kind's
  natural key (blob hash for file/chunk/symbol, module path, commit hash).
- **`FtsStore`** — explicitly **optional** (`fts: null` is a valid profile state);
  when absent, hybrid/keyword search reports unavailable rather than erroring.
- **`GraphStore`** — `replaceAll(nodes, edges)` (atomic truncate-rebuild),
  traversal methods (`neighbors`, `callers`, `callees`, `path`, `subgraph`).
  Internal traversal-depth cap `MAX_GRAPH_TRAVERSAL_DEPTH = 3`; a separate,
  looser `MAX_GRAPH_DEPTH_REQUEST = 64` bounds only *network-supplied* depth
  requests, deliberately far above the internal default so it never rejects a
  legitimate internal call. A Qdrant profile's `GraphStore` throws on every
  method — **fail loud, not silently empty** — "graph queries require a relational
  backend" is a deliberate, tested contract, not an oversight.

### 6.2 Why this split, and why it matters for a single-backend Kotlin port

`docs/storage-backends-plan.md` weighed three shapes: one unified `StorageBackend`
(rejected — "the Qdrant implementation still secretly needs a relational sidecar,
so 'single backend' is partly fiction"), vectors-only pluggable with SQLite
metadata fixed (rejected — "a dead end for the all-Postgres team scenario"), and
the four-interface split that shipped, chosen because it's the only shape that (a)
treats "some data can't go in a vector-only store" as a first-class fact rather
than a workaround, and (b) still allows a fully-relational deployment.

**This reasoning doesn't disappear just because the Kotlin port is single-backend
SQLite-only** (per constraint 2). The four-way *conceptual* split — dedup/metadata
facts vs. vector search vs. full-text vs. graph traversal — is still the right
seam even when one physical engine backs all four, because it keeps each
capability's query shape explicit and swappable later without leaking assumptions
across the others. The Kotlin port should keep four narrow interfaces backed by one
SQLite connection, not collapse them into one God-object DAO — but it should *not*
carry the async multi-backend plumbing (`resolveProfile`, backend selection by env
var, Postgres/Qdrant adapters) that exists only to make the four-way split usable
across three physically different engines. That plumbing is the part that doesn't
port; the interface shape does.

### 6.3 Consistency model — no cross-store transactions, by design

`storage-backends-plan.md` §8 states the model plainly: *"Indexing is idempotent
and content-addressed, so a partial write... self-heals on the next `index` run:
the deduper sees the blob is missing its vector/FTS entry and re-processes only
that one."* This is **not** two-phase commit — it's idempotent self-healing riding
on the exact same content-addressed dedup mechanism from §1.1. Only SQLite/Postgres
(single-connection engines) get a true atomic `writeFileBlob` (one transaction
covering blob+embedding+path+FTS); Qdrant, a separate network service from its
relational companion, cannot participate in that transaction and relies entirely on
idempotent re-index for recovery. `doctor.ts` detects (never prevents) drift —
e.g. `fileEmbeddingCount > blobCount` warns the two stores may be out of sync and
suggests `storage migrate`.

**For a single-SQLite-backend Kotlin port, this whole question simplifies
enormously**: one physical database, one connection, one transaction can cover
everything a `writeFileBlob` needs (blob + embedding + path + FTS row, if FTS is
even in the same engine) — there is no cross-*process* consistency problem to design
around at all, only the ordinary single-database transaction discipline. The
important thing to **carry forward, not discard**, is the underlying principle: **content-addressed idempotency is what makes "resume after interruption" and "the write happened twice" both trivially safe** (see §8.2) — that property is what actually protects a Kotlin implementation on a phone that gets killed mid-write, and it holds regardless of how many physical stores back the four interfaces.

### 6.4 Vector storage format — the seam to design carefully

Today, every vector-bearing table stores raw provider-output bytes in a SQLite
`BLOB` column (`vector: blob('vector', {mode:'buffer'})`, `dimensions INTEGER`
alongside for deserialization) — `Float32Array.buffer` written and read back
directly, no specialized vector type. This is simple and correct on a server where
the whole table can be scanned into memory per query (§4.1). It is precisely the
part that must change for §9's redesign: the porting brief requires vectors in a
**separate file, not SQLite rows** for the Kotlin port, specifically so scoring can
memory-map/stream instead of hydrating rows through a SQL query engine. See §9.3
for the concrete proposal.

---

## 7. Indexer orchestration and the Git-streaming replacement

### 7.1 Pipeline, as it exists today (`src/core/indexing/indexer.ts`, 1221 lines)

Three sequential macro-phases:

**A — Collection.** `revList()` streams `(blobHash, path)` pairs via a piped
`git rev-list --objects | git cat-file --batch-check` subprocess pair, but the
indexer **drains the entire stream into an in-memory array** before proceeding —
every historical (hash, path) touch across the requested range, not just unique
blobs. Content is never buffered (each blob's bytes are fetched later, individually), but the *index* of what to fetch is fully materialized up front. This
is in real tension with CLAUDE.md's own "streaming, never buffer entire history"
constraint — worth being honest about rather than treating as a model to copy (see
Decision C, §11). Dedup then happens in two passes: an in-memory `Set` (capped and
periodically cleared at 50,000 entries to bound memory) plus a batched (500/query)
`filterNewBlobs()` DB check, router-aware (grouped by which model a file would use).

**B — Embedding.** Either a batch pipeline (3-stage `AsyncQueue`-based
read→embed→store, active only under specific conditions: `embedBatchSize > 1`,
provider supports `embedBatch`, no dual-model router, `--chunker file`) or a
per-blob path (`p-limit`-throttled `Promise.all` over all pending blobs, each task
independently try/caught end-to-end so one blob's failure can't reject the whole
batch). The context-limit fallback chain (§2.4) lives only in the per-blob
whole-file path.

**C — Commit mapping.** A **second, independent full history walk**
(`streamCommitMap`) — and inside it, a **third**, fully-buffered, synchronous
`execFileSync('git', ['log', '--all', '--format=%H %D'])` just to build a
commit→branches decoration map before the streaming part even starts. So a single
`index start` run walks history at minimum three times, plus one `git cat-file
--batch` subprocess spawn *per unique new blob* (not a reused batch process,
unlike Phase A's `cat-file --batch-check` — this is the single biggest fork/exec
cost in the pipeline).

### 7.2 Resumability — the real granularity, precisely

`--since` defaults to `getLastIndexedCommit()`: `SELECT commit_hash FROM
indexed_commits ORDER BY indexed_at DESC LIMIT 1` — **the most recently *inserted*
row, not the most recent commit by Git ancestry.** Since `git log --all` walks
newest-to-oldest and `markCommitIndexed` fires in that stream order, the row with
the highest `indexed_at` is typically the *oldest* commit processed in a run, not
the newest. The next incremental run's `--since <that hash>` therefore excludes
only ancestors of an old commit — most of the history just walked gets **re-walked
and re-emitted** on the next run. This is safe (everything downstream is
idempotent) but wasteful, and the waste compounds every run.

**The actual load-bearing resumability unit is the single blob write**
(`storeBlob()`'s one-transaction blob+embedding+path+FTS insert, §1.1) — if the
process dies mid-run, every blob whose write already returned is durable and
`filterNewBlobs()` skips it next time; nothing is corrupted, nothing is
double-embedded. Commit-mapping durability is finer-grained but with a caveat:
`putCommit`/`linkBlobCommits`/`setBlobBranches` fire synchronously per commit
during the stream, but `markCommitIndexed` — the only thing the resume cursor
reads — is deferred for any commit with a non-empty message, into a post-stream
`Promise.all` fan-out. **If the process dies during the streaming loop itself**
(before it drains), essentially no message-bearing commits get marked, and the
next run's resume cursor doesn't advance past the *previous* run at all.

This is fine for a long-lived Node server that gets killed rarely and has CPU/RAM
to spare on a re-walk. It is a poor fit for constraint 3 (interruptible/resumable,
Android kills processes routinely) — see Decision C, §11, for the concrete
improvement the Kotlin port should make here rather than replicate.

### 7.3 Git layer → JGit mapping

| TS file | What it does | JGit equivalent |
|---|---|---|
| `revList.ts` | Streams `(blobHash, path)` via piped `git rev-list --objects` \| `git cat-file --batch-check`, `readline`-parsed, genuinely streaming, no full-output buffering | `RevWalk` iterating commits + `TreeWalk.setRecursive(true)` per commit's tree, filtered to non-tree entries, deduplicated by `ObjectId` — this is the one file whose *streaming* behavior should be preserved exactly, not "improved later" |
| `showBlob.ts` | Spawns a **new** `git cat-file --batch` subprocess *per call* (not reused), manually parses the batch header for size, aborts early past `maxBytes` (default 200 KB) | `ObjectReader.open(objectId).getBytes()` / `.getCachedBytes(sizeLimit)` — zero subprocess overhead, a strict improvement, not just a port |
| `commitMap.ts` | `buildCommitBranchMap()`: one synchronous, fully-buffered `execFileSync('git log --all --format=%H %D')` for branch decoration, **then** `streamCommitMap()`: spawned `git log --raw`, `readline`-parsed into commit/blob-touch events (added/modified only; deletions and content-unchanged renames are skipped) | `RevWalk` over commits + a tree diff per commit vs. its parent(s) (`TreeWalk`/`DiffFormatter` or manual `AbstractTreeIterator` comparison) for added/modified blob OIDs; `Repository.getAllRefs()` + `RevWalk.isMergedInto()` for branch decoration — **should be computed incrementally/streamed, not front-loaded as one buffered pass**, unlike the TS original (see Decision C, §11) |
| `walker.ts` | A separate, simpler dedup-by-hash blob walker used only by `gitsema status <file>`, not the indexer pipeline | Lower priority; same `TreeWalk` primitives, smaller surface |

### 7.4 Error containment pattern (port this shape, not the specific regex)

Every per-blob task in the concurrency-limited pool wraps each I/O/embedding stage
in its own try/catch, incrementing a cause-specific stat counter (`embedFailed` vs.
`otherFailed`) and `return`ing from that one task's closure — never letting one
blob's failure propagate and cancel the whole `Promise.all`. This is exactly
CLAUDE.md's "errors from embedding providers should be caught per-blob and counted
in stats" constraint, and it maps directly onto a Kotlin `coroutineScope` with
per-child `try/catch` (or `supervisorScope`, which achieves the same
non-propagation more idiomatically in Kotlin than the manual try/catch shape does
in TS). **Do not port the context-limit detection mechanism itself** (regex-sniffing
provider error *text*) — see Decision C, §11, for why a typed exception hierarchy
is the correct Kotlin replacement.

---

## 8. Building blocks confirmed portable as-is

To be explicit about what does *not* need redesign — most of the port is direct
translation, not novel design:

- Blob-hash content addressing and the `ON CONFLICT DO NOTHING` / existence-check
  write discipline (§1.1) — port verbatim.
- The two-level symbol-occurrence/graph-node identity split (§1.2), **if** any
  structural graph is built at all (Decision A).
- File/fixed chunking algorithms (§2.1–2.2) — pure, stateless, no native deps.
- int8 quantization math (§3.4) — pure arithmetic, trivially portable, should
  become the *default* rather than opt-in.
- `EmbeddingProvider` seam shape (§3.1) — already matches the porting brief's
  interface.
- Model-change/provenance compatibility check (§3.5) — cheap correctness, port
  as-is.
- Query-embedding cache (§4.5) — genuinely useful on a phone, low complexity.
- FTS-first philosophy (§4.3, constraint 6) — SQLite FTS5 ships in every Android
  SQLite build; this is free and should be the search baseline before any model is
  loaded.
- Boolean query grammar (§4.4) — trivial to port; its limitations (no NOT, no
  grouping) are a scope choice inherited from TS, not a phone-specific concern —
  fine to match unless product requirements demand more.
- The four-interface storage seam, single-SQLite-backed (§6.2) — keep the
  conceptual split, drop the multi-backend plumbing.
- Per-blob error containment shape (§7.4) — maps directly to `supervisorScope`.

---

## 9. Vector search redesign for Android — proposal for review

Constraint 1 requires this to be specified now and reviewed before any Kotlin is
written. This is a **proposal**, not a decision already made.

### 9.1 What must change, restated precisely

§4.1 established the TS approach: pull a capped-but-still-large candidate pool
(up to 50,000+ rows) fully into process memory as deserialized vectors, score every
one, sort twice. At 50,000 blobs × 768 dims × 4 bytes, that's ~150 MB of raw vector
bytes for whole-file embeddings alone, before per-object overhead and before
chunk/symbol embeddings — genuinely incompatible with a loaded LLM competing for
the same device's memory budget.

### 9.2 Proposed approach

1. **Quantization is the default, not opt-in.** §3.4's int8 scheme ports as-is:
   4× smaller than float32 for free, with the TS test suite's own >0.98
   round-trip-cosine bar as the accuracy floor to re-validate against real
   on-device models. At 50,000 blobs × 768 dims × 1 byte, the whole vector table
   is ~38 MB — already comfortably inside a 200 MB ceiling *before* any other
   optimization, which changes the shape of this problem considerably: brute-force
   scoring becomes plausible at this scale, and ANN becomes a scaling
   optimization to add later under real measurement, not a Tier-1 blocker.

2. **Vectors live in a separate flat file, memory-mapped, not SQLite rows** (per
   the porting brief). Format: a fixed-record-length binary file — one record per
   `(blob_hash reference, quant_min: Float32, quant_scale: Float32, data:
   ByteArray[dims])` — indexed by a small SQLite table mapping `blob_hash → record
   offset`. Fixed record length is what makes memory-mapping (`java.nio
   .MappedByteBuffer` / Kotlin `FileChannel.map()`) viable: any record is a direct
   offset computation, no parsing needed to seek. **Justification for this over
   SQLite BLOB rows**: a mmap'd file is backed by the OS page cache, not the JVM
   heap — reading a record doesn't allocate until the byte range is actually
   touched, and the OS evicts cold pages under memory pressure automatically,
   which is exactly the behavior wanted when a same-process LLM is also competing
   for RAM. A SQLite BLOB read, by contrast, always copies into a JVM byte array
   via the SQLite driver, with no page-cache-style eviction the app doesn't control.

3. **Streamed, bounded-heap scoring — no full materialization, ever.** Score
   candidates one record at a time directly off the mmap'd buffer (decode →
   dequantize → cosine → discard), maintaining only a fixed-size top-K min-heap
   (`K` = requested result count, typically 10–50) rather than an array that grows
   to candidate-pool size. Memory footprint during a search becomes O(K), not
   O(candidate pool) — a structural fix, not a tuning knob.

4. **No native ANN (usearch/HNSW) — confirmed correctly excluded per constraint
   2.** At the ~38 MB quantized scale from step 1, a full streamed scan of every
   vector in a repo may already be fast enough on real hardware that ANN isn't
   needed for Tier 1 at all. If profiling on a real device later shows brute-force
   too slow at larger blob counts, the natural next step is a **pure-JVM/Kotlin
   IVF-style bucketing** (cluster vectors into N centroids at index-build time —
   reusing the already-planned k-means machinery from §5's clustering capability —
   then at query time score only the nearest few centroids' buckets). This needs
   no native code, no JNI, no per-ABI build matrix, and degrades gracefully to
   exact search if the bucketing structure isn't built yet. **This is explicitly
   a "measure first" recommendation, not something to build speculatively in
   Tier 1** — brute-force-but-bounded should ship first and get profiled on a real
   device before any ANN complexity is added.

5. **FTS-first, vector-enhancement-second** (constraint 6, ported as a first-class
   design principle, not an afterthought): Android's bundled SQLite supports FTS5.
   A phone-local index should be queryable by keyword the moment indexing starts
   writing rows, with vector similarity layered in only once an `EmbeddingProvider`
   is actually available and has produced vectors for at least some of the corpus.
   This also directly satisfies constraint 5 (search never blocks on indexing):
   the natural degraded-result state is "FTS-only, marked as such," not "wait."

6. **Ranking weights (§4.2) ship as configurable defaults, not hardcoded
   constants**, given they're unvalidated in the source project itself — the
   Kotlin port's `gitsema eval`-equivalent harness (precision@k/recall@k/MRR)
   should be built early enough to actually check whether 0.7/0.2/0.1 make sense
   at phone-index scale before anyone treats them as settled.

### 9.3 What this proposal explicitly does not decide yet

- The exact on-disk layout/versioning for the flat vector file (needs a decision
  on schema evolution: what happens when `dims` changes for a model, whether the
  file is per-model or per-repo, etc.) — a Tier 1 implementation detail to work out
  in code, not a Phase 1 blocker.
- Whether IVF-style bucketing is ever built at all — deferred to real-device
  profiling data, per point 4 above.
- Whether IVF bucketing structures also need a build-on-desktop/ship-as-data path
  the way the structural graph does (§10.A) — worth revisiting once/if it's built.

---

## 10. Decisions

### Decision A — the structural knowledge graph and tree-sitter

**Finding, not assumption:** the graph extraction layer is genuinely, exclusively
tree-sitter-driven for its two load-bearing outputs — `symbols`' path-free
qualified-name/signature identity (§1.2) and `structural_refs` (import/call/
extends/implements sites). Both are native N-API bindings
(`tree-sitter@^0.25.0` + per-language grammar packages, all `optionalDependencies`
requiring a native build step). **`structural_refs.ts` has no regex fallback at
all** — it returns `[]` (never throws) when tree-sitter is unavailable, by explicit
design. There is no `web-tree-sitter`/WASM build anywhere in the TS project's
dependency tree today.

**But the graph is not monolithically dependent on it.** Splitting `src/core/graph/`
(1839 lines) by data source:

- **Zero native parsing required:** `co_change` edges (derived entirely from
  `blob_commits`/`commits` — two files whose blobs change together in the same
  commits, pure Git provenance), file nodes (minted from `paths` alone), the
  `semantic` lens of `hotspots`/`cascade` (embeddings + FTS + co-change churn
  only), file-level `semanticNeighbors` (embeddings-only lookup).
- **Requires tree-sitter output:** every `calls`/`imports`/`extends`/`implements`
  edge, hence `deps`, `unused`, default-mode `cycles`, structural-lens
  `similar`/`blastRadius`/`relate`, and the `structural`/`hybrid` lenses of
  `hotspots`/`cascade`. Symbol-granularity semantic neighbor lookup also needs it
  (looks up `symbols.qualified_name`, itself tree-sitter-derived), even though the
  *scoring* is pure embeddings.

**Documentation note, unrelated to the porting question but worth flagging while
in this file:** `docs/knowledge-graph.md`'s header still says "Status: Design / not
yet implemented," but `docs/PLAN.md` shows Phases 105–112 (plus later parity work,
147–148) all shipped. The design doc simply was never updated past its original
status line — a hygiene gap in the source repo, independent of anything this port
decides.

**Three sub-questions answered directly:**

1. *Is there a viable non-native extraction path for TS/JS/Python on Android?*
   Not proven, but plausible and worth a spike: tree-sitter has an official WASM
   target (`web-tree-sitter` + `tree-sitter build --wasm` per-grammar), which a
   pure-JVM WASM runtime like **Chicory** (explicitly designed to avoid native
   code, Android-safe) could in principle execute with no JNI and no native crash
   surface. This is general knowledge about the tree-sitter/Chicory ecosystem, not
   something established from gitsema's codebase — the TS project has never used
   WASM tree-sitter, gives no evidence about its performance, and gitsema-kotlin
   would need to write new binding glue against `web-tree-sitter`'s API surface
   (different from the native `tree-sitter` Node package's), not reuse anything.
   **Not a Tier 1 or Tier 2 dependency; a candidate future spike, gated on real
   device performance testing of Chicory-hosted parsing before it's trusted for
   anything user-facing.**

2. *What would a graph-less port lose?* Everything under "requires tree-sitter
   output" above: `deps`/`unused`/default-`cycles`/structural `similar`/
   `blastRadius`/`relate`, and the richer half of `hotspots`/`cascade`'s hybrid
   lens. Also lost: LSP-quality "go to definition"/call-hierarchy (which
   `docs/parity.md` confirms derives from the graph on the TS side). **Not lost**:
   co-change-based "what changes together" analysis, semantic (embeddings-only)
   variants of everything, and the two-level identity model's *reasoning* (§1.2),
   which remains correct and worth preserving in any future graph work even if no
   graph ships now.

3. *Could the graph be built on desktop and shipped to the device as data?* **Yes,
   and there's already a proven mechanism for exactly this pattern in the TS
   project**: `docs/prebuilt-index-distribution-plan.md` (drafted, not yet
   scheduled in gitsema-TS's own `PLAN.md`, but fully designed) specifies
   content-addressed, checksummed SQLite bundle export/import with idempotent
   `INSERT OR IGNORE` application, explicitly chosen because "sqlite **is** the
   serialization" and blob-first keys make delta application trivially safe and
   order-independent. That design's own delta-exclusion list already names
   `graph_nodes`/`edges` as **derived, rebuild-not-merge state** — exactly the
   "recomputable, path-bearing" half of §1.2's two-level model. This is not a new
   idea to invent for the port; it is the *existing* TS-side answer to "how do I
   move a rebuildable derived artifact between machines," applied to a new
   machine pairing (desktop/CI builder → phone consumer) instead of its original
   one (server → server, or server → offline consumer).

**Recommendation (for your review, not a unilateral decision):** do not build any
on-device tree-sitter path in gitsema-kotlin's Tier 1 or Tier 2. Instead:
   - Ship the **co-change-derived graph** (zero native deps, real value: "what
     changes together") as an ordinary Tier 2 capability, gated on cost per §5's
     table (it's already SAFE — pure SQL over `blob_commits`).
   - Treat the **structural** graph (calls/imports/extends/implements,
     symbol-level identity) as **out of Tier 1/2 scope**, buildable only via a
     desktop/CI companion tool (could live in gitsema-kotlin as a JVM-only,
     non-Android module, or simply reuse gitsema-TS's existing `graph build` +
     `index export` pipeline directly) that produces a bundle in the format
     `prebuilt-index-distribution-plan.md` already specifies, for the phone to
     `attach`/import read-only. Aidos would then get structural-graph answers only
     for repos someone has pre-built a graph for — which is an honest, explicit
     degradation (graph tools return "graph unavailable" as `GraphStore`'s Qdrant
     profile already does today, not a silent empty result), not a broken feature.
   - Revisit on-device WASM parsing (via Chicory or similar) only if real product
     demand emerges for structural-graph coverage on repos with no desktop-built
     bundle available, and only after a dedicated spike measures WASM tree-sitter
     parse throughput/memory on actual Android hardware.

### Decision B — which analysis capabilities earn phone placement

§5's cost table is the requested cost profile. Restated as a build-order
recommendation, corrected against the porting brief's suggested Tier 2 order using
that data (the brief's order was not cost-sorted — e.g. it places `impact` first,
but `impact` is one of the more expensive capabilities researched, doing a full
corpus scan with a path-lookup fallback that's worse still):

**Wave 1 — safe now, no dependency on the §9 vector-search redesign:**
`experts`, `healthTimeline` (cheapest, pure SQL), `evolution` (file),
`changePoints` (file), `semanticBisect`, `conceptLifecycle`, `commitSearch`,
`cherryPick`, `branchSummary`, `mergeAudit` (collision half), `refactorCandidates`.
Eleven capabilities, all genuinely bounded today, none requiring §9 to land first.

**Wave 2 — safe once §9's redesign lands, no independent work needed beyond
that:** `authorSearch` (pre-filtered candidates only), `ownershipHeatmap`,
`regressionGate`, `impact` (plus its small path-lookup-indexing fix),
`codeReview`/`securityScan` (plus hoisting the embedding load out of their
per-hunk/per-pattern loops).

**Wave 3 — needs independent redesign beyond §9, cost the redesign before
committing:** `deadConcepts` (two-pass streaming HEAD-centroid computation),
`changePoints` concept-wide variant (cap the embeddings scan + bound commit
sampling), `contributorProfile` (bound the author-history gathering pass
explicitly), `semanticBlame` (share one scan structure across all chunks in a
file instead of rebuilding per chunk), `docGap` (already better than O(N²), but
worth an explicit doc-blob-count safety cap).

**Wave 4 — defer until there's a specific reason to build them, cost is real and
structural, not just "needs streaming":** `debtScoring` (inherently pairwise;
needs actual pruning/ANN, not just a bounded scan — see §9.2 point 4), `clustering`
and `mergeAudit`'s merge-impact half (needs the independent streaming/mini-batch
k-means redesign noted in §5, and switching to primitive `FloatArray` storage,
before it's safe at all).

This is a recommendation for you to cut from, per the brief's own instruction —
Wave 1 is the obvious safe starting set; the boundary between Wave 2 and Wave 3/4
is where judgment calls about product value vs. redesign cost belong to you, not
this document.

### Decision C — where gitsema-TS is wrong for this target

Named explicitly, each with its concrete evidence from the research above rather
than asserted from intuition:

1. **`vectorSearch.ts`'s full-materialize-then-sort-twice pattern (§4.1, §9)** —
   correct given a server's RAM budget and a synchronous SQLite driver, actively
   dangerous next to a loaded on-device LLM. Already covered in depth by §9; the
   single biggest and most consequential departure.

2. **The indexer's own "streaming" claim doesn't fully hold** (§7.1, §7.3) — Phase
   A buffers the entire (blobHash, path) touch-list for the requested range before
   dedup even starts (not blob *content*, but still an unbounded-by-history-length
   structure); `commitMap.ts`'s branch decoration does one fully-buffered
   synchronous `execFileSync('git log --all')` up front. This is tolerable
   "server has RAM to spare" thinking that the TS project itself doesn't fully
   live up to its own stated design constraint (CLAUDE.md #4: "never buffer entire
   repo history in memory"). The Kotlin port must actually honor this constraint
   with JGit — streaming `RevWalk`/`TreeWalk` throughout, and branch-membership
   computed lazily/incrementally rather than as one buffered pre-pass.

3. **The resume cursor is "most recently inserted row," not "highest ancestor
   commit walked"** (§7.2) — safe (idempotent) but wasteful on a long-lived server
   that rarely dies mid-run. On Android, where process death mid-index is routine
   (constraint 3), this wastefulness compounds every time the app is backgrounded.
   The Kotlin port should track the actual highest-ancestry commit fully processed
   as its resume point, not insertion order — a real behavioral improvement, not
   just a faithful port.

4. **Regex-based provider-error sniffing for context-limit detection** (§2.4,
   §7.4) — `/context|input length|exceeds the context/i` against arbitrary error
   *text* is fragile even in TS, and becomes worse in a Kotlin `EmbeddingProvider`
   seam that must support an arbitrary host-supplied implementation (possibly a
   fully on-device model with its own error surface). The Kotlin `EmbeddingProvider`
   interface should define a typed exception (e.g. `ContextLengthExceededException`)
   that implementations throw explicitly, replacing string-matching with a
   contract.

5. **`clustering.ts`'s `number[][]` vector storage** (§5, §9) — an artifact of JS
   not having a cheap fixed-width numeric array type the way the JVM does. Kotlin's
   `FloatArray` (or `ByteArray` for quantized) recovers 2–8× the memory this
   specific implementation wastes purely from language representation, before any
   algorithmic change — this is a straightforward win the Kotlin port gets for
   free by not repeating a TypeScript-specific limitation, not something requiring
   design work.

6. **`securityScan.ts`'s unshared 6× full-corpus scan** (§5) — one independent
   `vectorSearch()` call per fixed pattern with no evidence of sharing the loaded
   embedding table across patterns. Fine when the table load is "just RAM" on a
   server; a real multiplier to eliminate explicitly on a phone (load/stream once,
   score against all 6 pattern queries in the same pass).

7. **Undocumented, unvalidated ranking constants treated as load-bearing**
   (§4.2) — 0.7/0.2/0.1 and 0.3 BM25 weight have no cited evaluation anywhere in
   the source project. Copying them verbatim into a very different scale regime
   (phone-local single-repo index vs. server-scale multi-repo) without
   re-validating would be inheriting an assumption, not a decision. Port `gitsema
   eval`'s precision@k/recall@k/MRR harness early enough to actually check this.

8. **The in-process result cache's design assumes a long-lived server process**
   (§4.5) — 60-second TTL, in-memory `Map`, lost on restart. On Android, where the
   host process can be backgrounded/killed at any moment, this buys much less than
   it does on a server, for real complexity (generation-counter invalidation
   correctness depends on every writer remembering to bump it). Recommend
   deferring it entirely from Tier 1/2, unlike the query-embedding cache (§4.5),
   which is unambiguously worth porting.

9. **Quantization as opt-in rather than default** (§3.4, §9.2) — a reasonable
   choice when disk/RAM are cheap and a `--quantize` flag lets an operator choose;
   the wrong default on a device where the same choice should almost always be
   "yes." The Kotlin port should flip this default, not just expose the same flag.

10. **The four-store *multi-backend* plumbing (backend selection by env var,
    Postgres/Qdrant adapters, `resolveProfile`'s cross-deployment resolution
    logic)** — correctly excluded already by constraint 2's "one SQLite
    implementation" mandate, but worth stating explicitly as a *confirmed*
    departure rather than leaving it implicit: the four-interface *seam* (§6.2)
    is worth keeping, the machinery that exists solely to make that seam portable
    across three physically different storage engines is not.

---

## 11. Open questions carried forward (not blocking Tier 1)

- FTS5's Porter-stemmer/ASCII tokenizer assumption may be a poor fit for
  non-English source comments/strings in Aidos's target corpora — not a Tier 1
  concern, but worth flagging for Aidos's own adapter layer to consider.
- The exact flat-vector-file format/versioning (§9.3) needs to be nailed down in
  code during Tier 1 implementation, not fully specified here.
- Whether IVF-style IVF bucketing (§9.2 point 4) is ever needed depends on
  real-device profiling data this document cannot produce.
- `docs/knowledge-graph.md`'s stale "not yet implemented" status header should
  probably be fixed in gitsema-TS independent of this port — noted here since it
  was discovered during this research, not because it's this document's job to fix.

---

## 12. Tool descriptions and result interpretations (model-facing text)

**Scope of this section, precisely:** the porting brief excludes `src/core/narrator/`
and `src/mcp/` as runtime logic (the agentic tool-calling loop, the MCP stdio
protocol, LLM invocation) — that exclusion stands. But two files inside
`narrator/` are not runtime logic at all; they are **model-facing prose and JSON
schemas**, authored once and consumed by three different surfaces in gitsema-TS
(`gitsema guide`'s system prompt, the narrator/explain LLM prompts, and the
generated `skill/gitsema-ai-assistant.md`). That text — what a tool is called,
what arguments it takes, and critically, how to *read* its numbers — is exactly
the material a Kotlin library cannot regenerate from its own code, and exactly
what a consuming host (Aidos) needs if it wants to hand any of these capabilities
to a model of its own. **This section ports the data, not the loop that used it.**

Two source files, cataloged for every Tier 1 and Wave 1 capability (§9's search
core, and Decision B's Wave 1 list from §10):

- **`src/core/narrator/guideTools.ts`** (1,814 lines) — the "how to call it" half:
  one entry per tool, each pairing a `name`/`description`/JSON-schema
  `parameters` with an executable `run()`. Only the `definition` half (name,
  description, parameters) is in scope here — `run()` is the runtime logic this
  port explicitly excludes.
- **`src/core/narrator/interpretations.ts`** (695 lines) — the "how to read it"
  half: `summary`, `resultShape`, and `interpretation` (thresholds, what's
  significant, caveats) per tool, plus `aliases` for alternate registered names
  (e.g. MCP tool names that differ from the guide tool name). The file's own
  header states why this is the more valuable half and why it is kept
  dependency-free: *"this registry is dependency-free prose so the skill
  generator and the narrators can import it without pulling in `guideTools.ts`'s
  heavy executor dependency graph."* That reasoning holds without modification in
  Kotlin — an interpretation object must not depend on the class that implements
  the capability, only describe its output.

### 12.1 The discipline worth carrying, not just the content

gitsema-TS enforces three invariants across these two files plus a generated
artifact, via `scripts/gen-skill.mjs` and `tests/docsSync.test.ts`
("`TOOL_INTERPRETATIONS coverage`" describe block):

1. **Coverage**: every entry in `GUIDE_TOOLS` has a matching entry in
   `TOOL_INTERPRETATIONS` (`Object.keys(GUIDE_TOOLS).filter(name =>
   !TOOL_INTERPRETATIONS[name])` must be empty) — you cannot ship a callable tool
   with no reading guidance.
2. **Resolvability**: every `TOOL_INTERPRETATIONS` entry (by name or alias)
   resolves a usage definition in `GUIDE_TOOLS` — you cannot ship reading
   guidance for a tool that isn't actually callable.
3. **Generated-artifact staleness**: `gen-skill.mjs` joins the two registries by
   name into a rendered Markdown block (usage + result shape + "how to read it"
   per tool, grouped by category); a checked-in copy of that block lives in
   `skill/gitsema-ai-assistant.md` (mirrored to `.github/skills/gitsema.md`); the
   test regenerates the block at test time and asserts it matches the committed
   copy byte-for-byte, with an actionable failure message (`run \`pnpm gen:skill\`
   to regenerate`).

**Port this exact three-part shape** — two small, independent registries plus a
generator-and-test pair — not just today's tool list. The reason the source
project keeps `guideTools.ts` and `interpretations.ts` as two files instead of
one is itself worth preserving: usage text changes when an argument is added;
interpretation text changes when a threshold is retuned or a result shape
changes. Coupling them into one file/class means either change touches code the
other change has no business touching.

**Proposed Kotlin shape** (data classes, no behavior):

```kotlin
data class ToolDescriptor(
    val name: String,
    val description: String,
    val parameters: ParameterSchema,
)

data class ParameterSchema(
    val properties: Map<String, ParameterSpec>,
    val required: Set<String> = emptySet(),
)

data class ParameterSpec(
    val type: ParameterType,   // STRING, INTEGER, BOOLEAN, ENUM, ARRAY
    val description: String,
    val minimum: Number? = null,
    val maximum: Number? = null,
    val enumValues: List<String>? = null,
)

data class ToolInterpretation(
    val name: String,
    val category: ToolCategory,
    val summary: String,
    val resultShape: String,
    val interpretation: String,
    val aliases: List<String> = emptyList(),
)

enum class ToolCategory { SEARCH, HISTORY, BRANCH, OWNERSHIP, QUALITY, ADMIN }

object GitsemaToolCatalog {
    val descriptors: Map<String, ToolDescriptor> = mapOf(/* §12.3 */)
    val interpretations: Map<String, ToolInterpretation> = mapOf(/* §12.3 */)
}
```

A JVM-only generator (a small script or a `main()`, not shipped to Android) joins
the two by name into a rendered Markdown catalog, mirroring `gen-skill.mjs`
exactly; a test mirroring `docsSync.test.ts`'s three assertions above guards it.
**The consuming host decides what to do with `GitsemaToolCatalog`** — hand it to
its own agent loop, render it into its own system prompt, ignore it entirely.
This library ships the data and the freshness guarantee, never a loop that calls
a model with it.

### 12.2 Finding, stated plainly: most of this text is already single-repo-scoped

Before flagging exceptions: the large majority of the text below required **no
rewording**. `gitsema guide`'s tool text was authored for a single CLI session
already scoped to one local repository (the guide agent runs against `.gitsema/`
in the current directory), so most entries never mention multi-repo, auth, or
remote concerns at all — those concerns live in tools this port correctly
excludes already (`multi_repo_search`, `cross_repo_similarity`, both Tier 3). The
exceptions, below, are genuinely few and each is called out with its reworded
replacement.

### 12.3 Catalog — Tier 1 (search core)

**`semantic_search`**
- Description: *"Vector similarity search over the indexed git history. Returns
  the top matching files/blobs."*
- Parameters: `query` (string, required) — natural-language search query;
  `top_k` (integer, 1–25, default 10); `branch` (string) — restrict to blobs seen
  on this branch.
- Result shape: `{ query, results: [{ paths[], score, blobHash }] }`.
- How to read it: *"Ranked by cosine similarity (0–1): roughly >0.75 is a strong
  match, 0.5–0.75 is related, <0.5 is weak. Each result is a content-addressed
  blob; the same blob can appear under several paths. Use the top paths as the
  most relevant files; cite the short blob hash."*
- **Flagged — CLI-output-format assumption, drop it:** the source interpretation
  continues, *"In text output, hashes appear as [blob:abc1234] — the 'blob:'
  prefix marks these as blob hashes... not commit hashes."* This describes
  gitsema-CLI's specific text-rendering convention, which no consuming host has
  any reason to replicate. **Port only the substantive half** (the threshold
  bands and the blob-vs-path distinction); drop the citation-format sentence, or
  replace it with a neutral note that a `blobHash` and a `commitHash` are
  different identifier spaces and must not be conflated when citing evidence —
  that fact is real and worth keeping, its CLI rendering convention is not.

**`index`**
- Description: *"Index (or incrementally re-index) the Git repository at the
  current working directory. This is a WRITE operation that embeds blobs — only
  run it when the index is missing or stale."*
- Parameters: `since` (string) — date, tag, commit hash, or `"all"` for a full
  re-index; `concurrency` (integer, 1–16, default 4).
- Result shape: stats — `seen`, `indexed`, `skipped`, `oversized`, `filtered`,
  `failed`, `commits`.
- How to read it: *"A WRITE operation that embeds blobs — only run it when the
  index is missing or stale, and prefer asking the user first for large repos.
  `indexed` is new work done; a high `failed` count points to an unreachable
  embedding provider."*
- **Flagged — implicit-cwd invocation model:** *"at the current working
  directory"* assumes a single-process, single-repo-via-`cwd` invocation model —
  correct for a CLI subprocess, wrong for a library where the caller holds an
  explicit repository handle. This resolves cleanly rather than needing a hard
  rewrite: Tier 1's `SemanticIndex` interface (per the porting brief) is already
  instance-scoped to one repository (`suspend fun index(ref: String, ...)`, no
  path/cwd parameter, because the instance itself *is* the repo binding) — so the
  underlying API was never going to inherit this assumption. What needs
  rewording is only the **tool descriptor's description string**, for a host that
  exposes `index` as a named tool to its own model: *"Index (or incrementally
  re-index) the given repository. This is a write operation that embeds blobs —
  only run it when the index is missing or stale."* The result-shape/interpretation
  text needs no change — it's already repo-instance-agnostic.

*(Tier 1's `search()`/`status()` interface methods otherwise correspond to
`semantic_search` above and — see below — nothing in gitsema-TS's registry.)*

**`status` — a genuine gap, not a rewording problem.** `gitsema status` exists as
a CLI command but was never registered as a `guide`/MCP tool (confirmed: no
`status`/`index_status`/`coverage` entry exists in `guideTools.ts` or
`interpretations.ts`). There is no TS-side model-facing text to port for Tier 1's
`SemanticIndex.status()`. The Kotlin port must originate its own
`ToolDescriptor`/`ToolInterpretation` for this one from scratch — a small, bounded
task (report index coverage: blob/embedding counts, last-indexed commit, model
config), not a blocker, but worth flagging so it isn't mistaken for an oversight
in the extraction above.

### 12.4 Catalog — Wave 1 (§10 Decision B's cheapest-first build order)

**`experts`**
- Description: *"List top contributors by semantic area (which concepts/clusters
  they work on)."*
- Parameters: `top_n` (integer, 1–25, default 10); `since`/`until` (string dates);
  `min_blobs` (integer, ≥1, default 1); `top_clusters` (integer, 1–25, default 5).
- Result shape: contributors with `blobCount` and their top clusters
  (`label`, `blobCount`, `representativePaths`).
- How to read it: *"Maps people to the concept clusters they own. ... Use it to
  route work or find reviewers by area rather than by file paths."*
- **Flagged — CLI-invocation phrasing:** the source continues, *"Requires clusters
  to exist (**run `clusters` first**)."* — an instruction phrased as a CLI
  command invocation. The underlying fact is real (this capability reads
  `cluster_assignments`, populated by the clustering capability, per §5) and must
  be kept; only the phrasing needs to generalize: *"Requires the clustering
  capability to have already been run against this index — its output is empty
  until then."*

**`health_timeline`**
- Description: *"Time-bucketed codebase health metrics: active blob count,
  semantic churn rate, and dead-concept ratio."*
- Parameters: `buckets` (integer, 1–50, default 12); `branch` (string).
- Result shape: per-bucket rows — `activeBlobCount`, `semanticChurnRate`,
  `deadConceptRatio`.
- How to read it: *"Rising churn means more concept turnover; a rising
  dead-concept ratio means more stale/removed code. Read the trend, not single
  buckets — sustained high churn or a growing dead ratio are health concerns;
  stable low values indicate maturity."*
- No server assumption. Ports as-is.

**`file_evolution`** (source alias for the file-scoped `evolution` capability, §5)
- Description: *"Track a single file's semantic drift across its Git history."*
- Parameters: `path` (string, required); `threshold` (number, default 0.3).
- Result shape: version timeline — `distFromPrev`/`distFromOrigin` per step.
- How to read it: *"`distFromPrev` (cosine, 0–2) is how much it changed from the
  prior version and `distFromOrigin` is cumulative drift. Steps at/above the
  threshold (default 0.3) are large changes worth explaining — correlate their
  dates/commits with what happened. Steady small distances mean incremental
  change; a spike means a rewrite or repurposing."*
- No server assumption. Ports as-is.

**`file_change_points`**
- Description: *"Detect semantic change points in a single file's Git history."*
- Parameters: `path` (string, required); `threshold` (number, default 0.3);
  `top_points` (integer, 1–25, default 5); `branch` (string).
- Result shape: `{ points: [{ before, after, distance }] }`.
- How to read it: *"File-scoped version of change_points: the dates where the
  file changed most in meaning. Use the before/after blob hashes to diff what
  actually changed at each inflection."*
- No server assumption. Ports as-is.

**`concept_lifecycle`**
- Description: *"Analyze the lifecycle stages (born → growing → mature →
  declining → dead) of a semantic concept across Git history."*
- Parameters: `query` (string, required); `steps` (integer, 2–50, default 10);
  `threshold` (number, default 0.7).
- Result shape: `{ bornTimestamp, peakTimestamp, peakCount, currentStage, isDead,
  points[] }`.
- How to read it: *"Read it as a story: when the concept was born, when it
  peaked, and its current stage/growth trend. `isDead` flags concepts with no
  recent matches — useful for spotting abandoned ideas vs. ones still actively
  developed."*
- No server assumption. Ports as-is.

**`semantic_bisect`**
- Description: *"Binary search over commit history to find where a concept
  diverged from a 'good' baseline (semantic git bisect)."*
- Parameters: `good_ref`/`bad_ref`/`query` (string, required); `top_k` (integer,
  1–50, default 20); `max_steps` (integer, 1–25, default 10).
- Result shape: `{ culpritRef, maxShift, steps: [{ ref, date, blobCount,
  distanceFromGood }] }`.
- How to read it: *"`culpritRef` is the bisection's best guess for when the
  concept diverged... Treat the culprit as a narrowed time window to investigate
  further (e.g. with change_points or file_evolution), not a definitive single
  commit."*
- No server assumption. The cross-reference to sibling tool names (`change_points`,
  `file_evolution`) is fine to keep, but only makes sense to a host whose own tool
  registry includes both — worth a light footnote in the Kotlin doc rather than a
  rewording.

**`branch_summary`**
- Description: *"Generate a semantic summary of what a branch is about compared
  to its base branch."*
- Parameters: `branch` (string, required); `base_branch` (string, default
  `"main"`); `top_concepts` (integer, 1–25, default 5).
- Result shape: `{ branch, baseBranch, mergeBase, exclusiveBlobCount,
  nearestConcepts[], topChangedPaths[] }`.
- How to read it: *"`nearestConcepts` (with similarity) name what the branch is
  about; `topChangedPaths` (with drift) are where it diverges most.
  exclusiveBlobCount=0 means the branch adds nothing new vs base (or is not
  indexed)."*
- No server assumption — branches are a local-repository concept, not a
  multi-tenant one. Ports as-is. The `base_branch` default of `"main"` is a
  convention worth keeping configurable rather than hardcoded, since a phone-local
  repo may default its base branch differently.

**`merge_audit`** (the collision-detection half of Wave 1; `merge_preview` is a
separate, Wave-4-tier tool since it depends on full k-means clustering per §5 —
cataloging it is deferred until clustering itself is built)
- Description: *"Detect semantic collisions between two branches — pairs of
  files about the same concept even without shared lines."*
- Parameters: `branch_a`/`branch_b` (string, required); `threshold` (number,
  default 0.85); `top_k` (integer, 1–50, default 20).
- Result shape: `{ blobCountA/B, centroidSimilarity, collisionZones[],
  collisionPairs[] }`.
- How to read it: *"Collision pairs are files on each branch that are
  semantically close (similarity ≥ threshold, default 0.85) even without shared
  lines — likely conflict/duplication risks at merge. High centroid similarity
  means the branches overlap broadly. Review the top pairs before merging."*
- No server assumption. Ports as-is.

**`refactor_candidates`**
- Description: *"Find pairs of symbols/chunks/files that are semantically
  similar enough to be refactoring candidates."*
- Parameters: `threshold` (number, default 0.88); `top_k` (integer, 1–50,
  default 50); `level` (enum `symbol`/`chunk`/`file`, default `symbol`).
- Result shape: `{ threshold, level, totalScanned, pairs: [{ similarity, a, b }]
  }`.
- How to read it: *"High `similarity` (near the threshold, default 0.88, max
  1.0)... likely duplicated or near-duplicated logic — candidates for extraction
  into a shared helper... Not every pair is worth merging — check whether the
  duplication is incidental (e.g. boilerplate) or meaningful."*
- No server assumption. Ports as-is.

**`cherry_pick_suggest`**
- Description: *"Suggest commits to cherry-pick based on semantic similarity of
  their commit messages to a query."*
- Parameters: `query` (string, required); `top_k` (integer, 1–25, default 10).
- Result shape: `{ query, results: [{ commitHash, score, message, paths[] }] }`.
- How to read it: *"Ranked by relevance to the query (higher `score` = more
  relevant). Each result is a candidate commit to cherry-pick onto another
  branch — check `paths` for what it touches and `message` for intent before
  recommending it; relevance does not guarantee the commit applies cleanly
  elsewhere."*
- No server assumption. Ports as-is.

### 12.5 Summary of flags

Three genuine flags out of thirteen entries cataloged (Tier 1's two plus eleven
of Wave 1's — `merge_preview` excluded pending clustering):

| Tool | What's server/CLI-flavored | Fix |
|---|---|---|
| `semantic_search` | Interpretation cites the CLI's `[blob:...]` text-rendering convention | Drop the rendering convention; keep the substantive blob-vs-commit-hash distinction |
| `index` | Description says "at the current working directory" (implicit single-repo-via-cwd) | Reword description to "the given repository"; the underlying Tier 1 API was never cwd-scoped, only the tool descriptor's prose was |
| `experts` | Interpretation phrases a data dependency as a CLI command ("run `clusters` first") | Reword to describe the dependency generically ("requires the clustering capability to have already been run") |

Everything else cataloged above ports verbatim — the finding in §12.2 holds: this
text was written for a single local repository already, and needed far less
translation than a "server → phone" port usually implies.

---

## 13. Source map (for future reference, not for direct reading)

Every claim above traces to one of: `src/core/{chunking,embedding,search,
indexing,storage,db,graph,git}/*.ts`, `docs/knowledge-graph.md`,
`docs/patterns.md` (workflow-composition catalog, not a design-principles doc —
corrected from the porting brief's assumption), `docs/parity.md`,
`docs/locked-model-set-plan.md`, `docs/storage-backends-plan.md`,
`docs/prebuilt-index-distribution-plan.md`, `docs/review10.md`, `docs/review11.md`,
`CLAUDE.md`. §12 additionally traces to `src/core/narrator/guideTools.ts` (usage
definitions only, not `run()`), `src/core/narrator/interpretations.ts` in full,
`scripts/gen-skill.mjs`, and `tests/docsSync.test.ts`'s `TOOL_INTERPRETATIONS
coverage` block. An implementer who finds a gap between this document and the actual
TS source should treat this document as needing a correction, not the source as
needing a re-read — but if genuinely stuck, the file:line citations throughout are
real and current as of this research pass.
