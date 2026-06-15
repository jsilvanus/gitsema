# Design Doc — Structural Knowledge Graph Layer

> Status: **Design / not yet implemented.** Target track: Phases 105–110.
> Scope decision (owner): build the **structural** graph first (typed edges from
> static analysis), starting with **TypeScript/JavaScript + Python**, then expand
> to Go/Rust/Java. A separate presentation/UI graph (Phase 110) folds in later.

This document is the single design reference for the knowledge-graph track. It
nails down the **identity model**, the **schema**, the **per-language name-resolution
heuristics**, and the **phase boundaries** before any code lands. Phase entries in
[`PLAN.md`](PLAN.md) should link here rather than restating the design.

> **Revision note (Codex review, PR #90):** the identity model was corrected so
> per-blob occurrences are **path-free** (a blob may map to many paths and is parsed
> once), and the node space now includes an explicit **`file` node** so that
> file-level edges (`defines`, `imports`, `co_change`) and top-level call sites have
> valid endpoints. See §2.1, §2.3, §3.

---

## 1. Motivation & relationship to what exists

gitsema today is a **semantic-embedding-first** index. It has three retrieval
systems that already agree on one canonical ID (`blob_hash`):

- **Vectors** — cosine / ANN over per-blob, per-chunk, per-symbol embeddings.
- **FTS** — BM25 over `blob_fts`.
- **Metadata** — `paths`, `commits`, `blob_commits`, `blob_branches` (relational truth).

What it lacks is **structural relationships**. Concretely, as of schema v23:

- There is **no** `calls` / `imports` / `defines` / `extends` edge anywhere — no
  edges table, no graph traversal.
- `impact.ts` ("coupling") is **purely semantic** (cosine distance), not structural.
- `symbols` (`src/core/db/schema.ts:159`) store a bare `symbolName`, `symbolKind`,
  `language`, and line range — **no qualified name, no signature, no parent scope,
  no stable identity** (the PK is an auto-increment `id` that does not survive a
  re-index). Extraction (`functionChunker.ts:331`) walks only the **top-level**
  `rootNode.namedChildren` with no scope stack, so nested symbols and their owners
  are not modeled.
- LSP "references" (`core/lsp/server.ts`) is textual name-matching at query time,
  not a stored reference/call graph.

The knowledge-graph layer adds a **structural truth layer** on top of the existing
blob-first index: typed, queryable, temporally-aware edges between stable nodes —
without violating any of the project's non-negotiable constraints.

### Constraints this design must respect (from `CLAUDE.md`)

1. **Git is the source of truth.** No state Git already knows.
2. **Blob-first / immutable.** Anything extracted from a blob is computed **once per
   blob hash** and never recomputed (same discipline as embeddings). A blob is
   parsed **without reference to any path** — `paths` is one-blob→many-paths
   (`schema.ts:89`) and the indexer dedups by blob hash (`indexer.ts`).
3. **Streaming.** Extraction is per-blob; never buffer whole history.
4. **CLI-first; MCP thin.** Graph queries are core modules; MCP/HTTP wrap them.
5. **Storage seam.** The graph lives in the **relational** store (`MetadataStore`:
   SQLite + Postgres). Qdrant is vectors-only and is explicitly **not** a graph
   backend — non-relational profiles must **fail loud**, not silently no-op
   (cf. review9 §4).

---

## 2. Core design decision — two-level identity

The central tension: the graph wants **stable nodes** so that `A calls B` survives
across file versions, but gitsema is **blob-first / immutable** and a blob has **no
single path**. We resolve this with a two-level model that mirrors the existing
split between immutable embeddings (per-blob) and recomputable derived artifacts
(clusters, module centroids, projections).

| Level | What it is | Lifecycle | Identity |
|---|---|---|---|
| **Symbol occurrence** | A symbol as parsed from **one blob version** (today's `symbols` table, enriched) | **Immutable**, dedup'd by blob hash — extracted once per blob, never recomputed | **path-free:** `(blob_hash, qualified_name, signature_hash)` |
| **Graph node** | The **logical** thing tracked across versions — a `file`, a `symbol`, or an `external` target | **Recomputable** — rebuilt by `gitsema graph build` | `node_key` (see §2.3) |
| **Edge** | A typed relationship between two nodes | **Recomputable**, but carries Git provenance (first/last commit observed) | `(src_key, dst_key, edge_type)` |

The key move: **occurrences carry no path; path is attached only when building
nodes.** Parsing a blob yields intrinsic facts (`qualified_name`, `signature`) that
are true regardless of where the blob lives. The path-bearing identity is produced
at node-build time by joining the occurrence's blob against `paths` — so a blob that
appears at two paths fans out to two symbol nodes, with no arbitrary path choice and
no per-path re-parse.

### 2.1 Occurrence identity (path-free, immutable)

A parsed symbol records:

- `qualified_name` — the scope chain joined by `.`: `Outer.Inner.method`,
  `module.func`, `Trait::method`. Requires a **recursive AST walk with a scope
  stack** — the single biggest change to the current top-level-only extractor.
- `signature` / `signature_hash` — short hash of the **normalized** parameter list
  (and, where cheap, the return type). Normalization strips whitespace, default
  values, and parameter names, keeping arity + types where the grammar exposes them;
  for dynamically-typed languages (Python/JS) it degrades to arity + parameter
  names. Disambiguates overloads.
- `parent_qualified_name` — the enclosing scope's qualified name (path-free; `null`
  at top level), so node-build can reconstruct `contains` edges without a stored
  path-bearing key.

None of these reference a path, so they are blob-intrinsic and immutable.

### 2.2 Provenance gives temporal edges for free

Every edge is **observed in** specific blobs/commits. Storing `first_seen_commit`,
`last_seen_commit`, and `observed_count` on each edge yields temporal edges
(`when did this call relationship first appear?`) using the exact mechanism that
already powers `first-seen` via `blob_commits`. `co_change` edges are derived
entirely from `blob_commits` (two **files** whose blobs change in the same commits).

### 2.3 Node space — `file`, `symbol`, `external`

Nodes are one of three kinds, all sharing one `node_key` string space:

| Kind | `node_key` | Notes |
|---|---|---|
| `file` | `[repo_id "/"]? path` | One per file path. Anchors file-level edges (`defines`, `imports`, `co_change`) and top-level call sites whose enclosing symbol is `null`. |
| `symbol` | `[repo_id "/"]? path "#" qualified_name "#" signature_hash` | One per (path, qualified symbol). Built by joining occurrence × `paths`. |
| `external` | `ext:<raw_name>` | Unresolved / third-party targets (stdlib, deps). Keeps `calls`/`imports` total instead of dropping unresolved edges. |

`repo_id` is present only in multi-repo deployments (omitted in the common
single-repo case so keys stay readable). The `symbol` key is **not** content-addressed
— that is what makes it stable across edits. A file rename mints a new key in v1;
rename/move tracking is a later refinement (see §8).

---

## 3. Schema

Extraction is split into an **immutable per-blob** layer and a **recomputable
derived** layer, exactly like `embeddings` (immutable) vs `module_embeddings` /
`blob_clusters` (recomputed).

### 3.1 Extend `symbols` (occurrences, path-free) — migration v23 → v24

Add intrinsic, path-free identity to the existing table (all nullable for
back-compat; older rows simply lack them until re-indexed):

```ts
symbols += {
  qualifiedName:       text('qualified_name'),        // "Auth.validateToken" — path-free
  signature:           text('signature'),             // normalized param list
  signatureHash:       text('signature_hash'),        // short hash of signature
  parentQualifiedName: text('parent_qualified_name'), // enclosing scope's qualified name (path-free)
}
```

Add an index on `(qualified_name, signature_hash)` and `(blob_hash, qualified_name)`.
**No `symbol_key` column** — the path-bearing key is derived at display time (the
search join already has a path) and at node-build (§3.3).

### 3.2 New: `structural_refs` (immutable, per-blob) — migration v24 → v25

Raw, unresolved structural references extracted from one blob. **Immutable and
dedup'd by `blob_hash`** — the same blob is parsed exactly once. Resolution happens
later (§3.3); this table only records what the parser literally saw.

```ts
structural_refs = sqliteTable('structural_refs', {
  id:                     integer().primaryKey({ autoIncrement: true }),
  blobHash:               text('blob_hash').notNull().references(() => blobs.blobHash),
  enclosingQualifiedName: text('enclosing_qualified_name'), // who referenced (path-free; null = file/top-level scope)
  refKind:                text('ref_kind').notNull(),    // import | call | extends | implements | reference
  rawTarget:              text('raw_target').notNull(),  // literal text: "validateToken", "./auth", "BaseController"
  targetModule:           text('target_module'),         // for imports: resolved module specifier
  line:                   integer('line').notNull(),
})
```

`enclosing_qualified_name` is path-free (the occurrence layer has no path). At
node-build, an `enclosing_qualified_name` of `null` resolves to the **file node**;
otherwise it resolves to the symbol node at `path#enclosing#sig`.

### 3.3 New: `graph_nodes` + `edges` (recomputable) — migration v25 → v26

Rebuilt wholesale by `gitsema graph build`. Truncate-and-rebuild is acceptable
(like cluster recompute); incremental rebuild is a later optimization.

```ts
graph_nodes = sqliteTable('graph_nodes', {
  nodeKey:         text('node_key').primaryKey(),   // file: path | symbol: path#qname#sighash | external: ext:<name>
  kind:            text('kind').notNull(),          // file | function | class | method | ... | external
  displayName:     text('display_name').notNull(),
  path:            text('path'),                     // file the node lives at (null for external)
  repoId:          text('repo_id'),
  currentBlobHash: text('current_blob_hash'),       // most-recent occurrence (null for file aggregate / external)
  isExternal:      integer('is_external').default(0),
})

edges = sqliteTable('edges', {
  srcKey:          text('src_key').notNull(),       // a graph_nodes.node_key
  dstKey:          text('dst_key').notNull(),       // a graph_nodes.node_key
  edgeType:        text('edge_type').notNull(),     // see §5
  weight:          real('weight').default(1),        // observed_count or co-change strength
  confidence:      real('confidence').default(1),    // resolution confidence 0..1 (§4)
  firstSeenCommit: text('first_seen_commit'),
  lastSeenCommit:  text('last_seen_commit'),
  observedCount:   integer('observed_count').default(1),
}, (t) => ({ pk: primaryKey({ columns: [t.srcKey, t.dstKey, t.edgeType] }) }))
```

Indexes: `edges(src_key, edge_type)` and `edges(dst_key, edge_type)` to make
forward/reverse traversal (callees/callers) cheap.

---

## 4. Per-language extraction & name resolution

This is where the difficulty lives. Extraction of **sites** is reliable;
**resolution** of a site to a definition is language-specific and imperfect. We
therefore separate them (Phase 106 = sites, Phase 107 = resolution) and attach a
`confidence` to every resolved edge. Unresolved targets become `external` nodes —
still useful, never a hard failure.

Resolution proceeds in confidence tiers, highest first:

1. **Same-file** (confidence ~1.0) — target name matches a symbol defined in the
   same blob's symbol set.
2. **Imported** (confidence ~0.9) — target traces through an `import` in the same
   file to a path we have indexed; resolve to that file's exported symbol of the
   same name.
3. **Project-wide unique** (confidence ~0.6) — target name resolves to exactly one
   symbol anywhere in the repo.
4. **Ambiguous** (confidence ~0.3) — multiple candidates; pick by nearest
   path/module distance, record alternatives count in `weight`.
5. **Unresolved** (confidence 0) — mint/attach an `external` node keyed by the raw
   name. Covers stdlib and third-party calls.

### 4.1 TypeScript / JavaScript (first target)

Grammar: `tree-sitter-typescript` / `tree-sitter-javascript` (already loaded for
chunking). Extraction targets:

- **defines / contains** — recursive walk with a scope stack over
  `class_declaration`, `function_declaration`, `method_definition`,
  `arrow_function` assigned to a `variable_declarator`, `export` wrappers. The scope
  stack produces `qualified_name`; the parent frame yields `parent_qualified_name`
  and, at node-build, a `contains` edge (file→symbol at top level, symbol→symbol
  when nested).
- **imports** — `import_statement` (named, default, namespace) and
  `call_expression` to `require(...)`. `targetModule` = the specifier; relative
  specifiers are resolved against the file path to an indexed `paths` row.
- **calls** — `call_expression`: capture the callee identifier or the rightmost
  property of a `member_expression` (`a.b.c()` → `c`, with `a.b` recorded as
  `rawTarget` context).
- **extends / implements** — `class_heritage` → `extends_clause` /
  `implements_clause`.
- **signature** — `formal_parameters`; types kept when present (TS), else arity +
  names (JS).

Known imperfections (accept in v1): dynamic dispatch, `this`-bound calls across
class hierarchies, re-exports/barrel files, and computed member access. These land
as lower-confidence or `external`.

### 4.2 Python (first target)

Grammar: `tree-sitter-python`. Extraction targets:

- **defines / contains** — recursive walk over `function_definition`,
  `class_definition` (methods nest under their class → `Class.method`).
- **imports** — `import_statement` / `import_from_statement`; map dotted modules to
  indexed paths where the module corresponds to a repo file.
- **calls** — `call` nodes; callee is an `identifier` or `attribute` (`obj.method`
  → `method`, `obj` as context). `self.method()` resolves within the enclosing
  class (confidence ~0.9).
- **extends** — `class_definition` argument list (base classes) → `extends`.
- **signature** — `parameters`; arity + names (Python is dynamically typed; keep
  annotations when present).

Known imperfections: duck typing, monkey-patching, `getattr`/dynamic dispatch,
decorators that rebind names. Lower-confidence or `external`.

### 4.3 Later languages

Go, Rust, Java reuse the same `structural_refs` shape; only the node-type mapping
and import/heritage extraction differ. Deferred until TS/JS + Python are proven.

---

## 5. Edge types

All endpoints are `graph_nodes.node_key` values (`file`, `symbol`, or `external`).

| Edge type | src → dst | Source | Meaning |
|---|---|---|---|
| `contains` | file → symbol, symbol → symbol | scope stack | a file/symbol owns a nested symbol |
| `defines` | file → symbol | occurrences | a file defines this symbol |
| `imports` | file → file, file → external | `import` refs | a file imports a module/file |
| `calls` | symbol → symbol, file → symbol/external | `call` refs | caller invokes callee (top-level caller = file node) |
| `extends` | symbol → symbol/external | heritage | class/struct extends a base |
| `implements` | symbol → symbol/external | heritage | class implements an interface/trait |
| `references` | symbol/file → symbol/external | `reference` refs | non-call name reference (best-effort) |
| `co_change` | file ↔ file | `blob_commits` | two files change together (weight = co-occurrence count) |
| `similar_to` | any ↔ any | embeddings | **optional, materialized later** — semantic neighbor |

`co_change` is file-level because `blob_commits` operates at blob/file granularity,
not symbol granularity — symbol-level co-change would require line-range diffing and
is out of scope. `similar_to` is intentionally **not** part of the structural-first
scope — it is already available via `vectorSearch`; it is listed so the planner
(Phase 109) can treat semantic neighbors as edges without duplicating storage.

---

## 6. Traversal & query layer

A new `GraphStore` interface in the storage seam (alongside `MetadataStore` /
`VectorStore` / `FtsStore`):

```ts
interface GraphStore {
  neighbors(key: string, opts: { edgeTypes?: EdgeType[]; direction: 'out'|'in'|'both'; depth?: number }): Promise<GraphHit[]>
  callers(key: string, depth?: number): Promise<GraphHit[]>   // reverse `calls`
  callees(key: string, depth?: number): Promise<GraphHit[]>   // forward `calls`
  path(from: string, to: string): Promise<GraphPath | null>   // shortest typed path
  subgraph(seed: string, depth: number): Promise<{ nodes: GraphNode[]; edges: Edge[] }>
}
```

Implementation: **recursive CTEs** over `edges` (SQLite and Postgres both support
them). Depth is capped (default 3) to bound cost. Qdrant: `GraphStore` throws
`"graph queries require a relational backend"`.

---

## 7. Phase boundaries

| Phase | Title | Schema | Deliverable |
|---|---|---|---|
| **105** | Stable symbol identity | v24 | Recursive scope-stack extraction → path-free `qualified_name`, `signature`, `signature_hash`, `parent_qualified_name` on `symbols` (occurrence identity = `(blob_hash, qualified_name, signature_hash)`). The path-bearing `symbol_key` (`path#qname#sighash`) is **derived** at display/node-build, not stored. `code_search`/LSP `documentSymbol` show `Class.method(sig)`. No edges; independently useful; de-risks the rest. |
| **106** | Per-blob structural extraction | v25 | `structural_refs` (immutable, dedup by blob hash) populated during `index --graph` for TS/JS + Python. Sites only, no resolution. |
| **107** | Linking pass + `graph_nodes`/`edges` | v26 | `gitsema graph build` builds `file`/`symbol`/`external` nodes (joining occurrences × `paths`), resolves refs → typed edges with confidence tiers, materializes `co_change` from `blob_commits`. |
| **108** | Traversal + CLI/MCP | — | `GraphStore` seam (recursive CTEs); `gitsema graph callers\|callees\|neighbors\|path`; MCP `call_graph`/`graph_neighbors`. Makes `impact` structural. |
| **109** | Cascade query planner | — | `FTS filter → vector expand → graph traversal → merge/rerank`; structural signal in ranking. |
| **110** | Unified graph UI | — | Render subgraphs in HTML (reuse `htmlRenderer-clusters.ts` force-graph); nodes deep-link into existing per-command HTML views — binds the standalone HTML outputs together. |

Each phase ends with working software, tests, a `features.md` entry, a `PLAN.md`
status update, and a changeset (per `CLAUDE.md`).

---

## 8. Risks & mitigations

1. **Call resolution accuracy (highest).** Cross-file resolution is inherently
   imperfect. *Mitigation:* confidence tiers (§4), `external` nodes for unresolved
   targets, ship TS/JS + Python first, never hard-fail. Surface confidence in
   output so users can calibrate trust.
2. **Stable keys vs. refactors / renames.** A signature change or file rename mints
   a new `symbol`/`file` key, breaking edge continuity. *Mitigation:* acceptable for
   v1; rename/move detection (path+name fallback, git rename data) is a later phase.
3. **Indexing cost.** AST ref-extraction adds per-blob work. *Mitigation:* gate
   behind `index --graph` (opt-in) initially; dedup by blob hash means history
   re-walks are cheap.
4. **Backend divergence (review9 §4).** Graph is relational-only. *Mitigation:*
   `GraphStore` on Qdrant throws a clear error; `doctor` reports graph availability
   per backend.
5. **Scope-stack correctness.** The recursive walk is a real rewrite of the
   top-level-only extractor. *Mitigation:* Phase 105 is isolated and test-heavy
   (golden qualified-name fixtures per language) before any edges depend on it.

---

## 9. Non-goals (for this track)

- A general-purpose graph database — the relational `edges` table is sufficient at
  gitsema's scale; revisit only if traversal becomes the bottleneck.
- Whole-program type inference / a real compiler front-end — resolution is
  best-effort static heuristics, not soundness.
- Symbol-level `co_change` — `blob_commits` is file-grained; symbol-grained
  co-change is out of scope.
- Materializing `similar_to` edges up front — semantic neighbors stay computed on
  the fly until the planner (109) proves a need.
- Multi-repo unified vector key space — orthogonal; tracked separately.
