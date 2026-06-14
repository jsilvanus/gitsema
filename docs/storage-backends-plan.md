# Storage Backends & Index Scoping — Design Plan

**Status:** accepted — direction is **Option 1** (split `MetadataStore` +
`VectorStore` + `FtsStore`), three phases, async seam first. Implementation not
started.
**Targets:** Phases 101–103 (async seam first, then pgvector + Qdrant)
**Scope:** Pluggable storage backends (SQLite · Postgres+pgvector · Qdrant),
local or remote, with a clear index-scoping model (project / user / named).

---

## 1. Motivation

Today gitsema stores everything in a single `better-sqlite3` file at
`.gitsema/index.db`. That is excellent for the zero-config, single-developer,
single-repo case. It does not serve three other situations the user wants to
support:

1. **Shared / team indexes** — multiple people querying one index without each
   re-embedding the whole history.
2. **Large indexes** — repos where a single SQLite file and in-memory cosine
   scan become the bottleneck, where a purpose-built vector DB (pgvector,
   Qdrant) pays off.
3. **User freedom** — let people run gitsema the way their infrastructure
   already works: a Postgres they already operate, a Qdrant cluster they
   already run, or just a file on disk.

The goal is to make **where data lives** a configuration choice, without
forking the codebase or duplicating business logic (per the CLI-first design
constraint).

---

## 2. Conceptual model: separate the axes

The original request mixed several ideas under the word "scope". Untangling
them is the most important design step, because each axis is configured
independently.

### Axis A — **Scope** (which index does a command resolve to?)

This is about *identity and lifetime* of an index, not where bytes sit.

| Scope | Meaning | Anchor | Analogue |
|---|---|---|---|
| **project** | One index per git repo (today's default) | `.gitsema/` in repo root | `.git/` |
| **user** | One index shared across all of a user's repos | `~/.gitsema/` (XDG) | `~/.gitconfig` |
| **named** | An explicitly addressed index (e.g. a team's shared "backend-monorepo" index) | config / connection string | a database name |

> **On "local":** "local" is **not** a scope — it is a *location* (Axis B). A
> project-scoped index can live on local disk *or* in a remote Postgres. The
> three scopes above replace the ambiguous "local / user / project" triad with
> a clean one. (gitsema's existing config already has exactly two *config*
> scopes — `local` = repo `.gitsema/config.json`, and `global` = user
> `~/.config/gitsema/config.json` — which map onto **project** and **user**
> here.)

### Axis B — **Location** (where do the bytes physically live?)

| Location | Meaning |
|---|---|
| **local** | On this machine's disk (SQLite file; or a Postgres/Qdrant on `localhost`) |
| **remote** | A network service: a Postgres/Qdrant server, or gitsema's own HTTP server fronting an index |

Location is largely implied by the backend's **connection string** (a file
path is local; a `postgres://host` or `https://qdrant` URL is remote). gitsema
*also* already has a "remote" mode where a thin client delegates embedding +
storage to a gitsema HTTP server (`GITSEMA_REMOTE`); that remains a valid way
to reach a remote index and is orthogonal to the DB backend the server uses.

### Axis C — **Backend** (what technology stores it?)

| Backend | Relational metadata | Vectors | BM25 / full-text |
|---|---|---|---|
| **sqlite** (default) | SQLite | SQLite BLOB + optional usearch HNSW | SQLite FTS5 |
| **postgres** | Postgres | pgvector | Postgres `tsvector` (or `pg_search`/ParadeDB BM25) |
| **qdrant** | *requires a companion relational store* | Qdrant collections | from the companion store |

The three axes compose. e.g. *project*-scope + *remote* + *postgres* = "this
repo's index lives in our shared Postgres". *user*-scope + *local* + *sqlite* =
"one personal index for all my repos, in `~/.gitsema`".

---

## 3. Current coupling (what makes this hard)

From the architecture study:

- **~115 import sites** call `getActiveSession()` / `getRawDb()` / `getDb()`
  directly. There is no storage interface — call sites reach for the DB handle.
- **230+ raw `.prepare()`** statements, synchronous `.transaction()`, `PRAGMA`,
  and **FTS5** are scattered across indexing, search, server, and CLI.
- **8 tables store vectors** as Float32/Int8 BLOBs; the other ~15 are
  relational metadata (blobs, paths, commits, branches, chunks, symbols,
  clusters, config, settings, repos, tokens…).
- **Search loads all candidate vectors into JS memory** and computes cosine in
  pure JS; `usearch` HNSW is an optional candidate-prefilter only.
- The killer detail: **`better-sqlite3` is synchronous; Postgres and Qdrant
  drivers are async.** Introducing them forces an async boundary that today
  does not exist anywhere in the read/write path.

---

## 4. Core decision — how far to abstract (the three options, explained)

The user asked to *explain the choices* rather than pre-pick one. Here they
are, with the trade-offs that matter.

### Option 1 — **Split into three stores: `MetadataStore` + `VectorStore` + `FtsStore`** ⭐ recommended

Keep a **relational metadata store always present** (SQLite *or* Postgres),
holding everything that is fundamentally relational — blobs, paths, commits,
`blob_commits`, branches, chunks/symbols metadata, clusters metadata, config,
settings, repos. Make the **vector store** pluggable (SQLite BLOB, pgvector,
Qdrant) **and** the **keyword/BM25 store** (`FtsStore`) independently pluggable
(SQLite FTS5, Postgres `tsvector`/`pg_search`, or a dedicated search engine).

A `StorageProfile` wires up all three; a backend may implement one, two, or all
three interfaces. `FtsStore` is **optional** — a profile with `fts: null` simply
has no keyword search, and `--hybrid` reports "unavailable" instead of erroring.

```
                 ┌─────────────────────┐   ┌────────────────────┐   ┌──────────────────────┐
   indexer ───►  │   MetadataStore     │   │    VectorStore     │   │   FtsStore (opt.)    │
   search  ───►  │ (SQLite | Postgres) │   │ (SQLite | pgvector │   │ (FTS5 | tsvector /   │
                 │  blobs, paths,      │   │  | Qdrant)         │   │  pg_search | engine) │
                 │  commits, branches… │   │  embeddings        │   │  BM25 keyword search │
                 └─────────────────────┘   └────────────────────┘   └──────────────────────┘
```

- **Pros:**
  - Matches the user's own observation — "some data cannot be placed into
    qdrant, so it's likely stored in db anyway." This makes that a *first-class*
    design fact instead of a workaround.
  - **Keyword search is independently swappable.** BM25 differs the most across
    backends (FTS5 vs `tsvector` vs none-in-Qdrant), so giving it its own seam
    lets us later drop in OpenSearch / Tantivy / Meilisearch without touching
    metadata, and lets hybrid search be cleanly optional.
  - Natural Postgres story: `postgres` metadata + `pgvector` vectors +
    `tsvector` FTS are all the *same* Postgres connection — one backend, three
    interfaces.
  - Qdrant becomes "just a vector store"; pair it with SQLite/Postgres metadata
    and any `FtsStore`. No need to reinvent the commit graph in Qdrant.
- **Cons:**
  - Three coordinated stores → write paths must keep them consistent (a blob's
    metadata row, its vector, and its FTS content). Needs a documented
    consistency story (idempotent re-index already gives us most of this — §8).
  - With Qdrant (or an external FTS engine), a write spans multiple systems (no
    single transaction). Acceptable because indexing is idempotent and
    content-addressed (re-running heals drift); `doctor` checks all three stores
    for orphans.

### Option 2 — **One `StorageBackend` interface covering everything**

Define a single interface; each backend implements *all* operations including
FTS/BM25 and the commit graph. SQLite, Postgres, and "Qdrant + relational
sidecar" each implement the whole surface.

- **Pros:** One seam, one mental model; call sites never think about "which
  store". Cleanest long-term if gitsema grows many backends.
- **Cons:** Largest refactor — *every* relational query (commit graph,
  ownership, clustering, debt scoring, temporal joins, FTS) goes behind the
  interface and becomes async. That's the bulk of the 230+ raw SQL sites, many
  of which are rich relational queries that pgvector/Qdrant gain nothing from
  abstracting. High effort, high regression risk, slow payoff. The Qdrant
  implementation still secretly needs a relational sidecar, so the "single
  backend" abstraction is partly fiction.

### Option 3 — **Vector store only; SQLite metadata fixed**

SQLite *always* holds metadata + FTS; only embeddings may move to
pgvector/Qdrant.

- **Pros:** Smallest possible change. Quickest path to "vectors in Qdrant".
- **Cons:** No all-Postgres / no server-side relational deployment — every node
  still needs a local SQLite metadata file, which undercuts the "shared team
  index in our Postgres" use case. A dead end for the team scenario.

### Decision

**Option 1 — split `MetadataStore` + `VectorStore` + `FtsStore` — is the chosen
direction.** It is the only option that (a) honors the "some data can't go in
Qdrant" reality as a design principle, (b) still unlocks a fully-remote
all-Postgres deployment for teams, and (c) keeps the FTS/commit-graph/temporal
machinery in the relational world where it's cheap, instead of forcing it
through a vector-store-shaped hole. Option 3 is what we'd fall back to if we
needed Qdrant *fast* and were willing to give up the shared-Postgres story;
Option 2 is a possible *later* consolidation once Option 1's seams have proven
themselves.

---

## 5. The async problem — strategy options (explained)

`better-sqlite3` is synchronous; `pg` and Qdrant's client are async. Whatever
abstraction we pick, the moment a non-SQLite backend exists, the store
interface must be **async** (return `Promise`). The question is how to get
there without a destabilizing big-bang.

### Strategy A — **Async interface, phased call-site migration** ⭐ recommended

Make the `MetadataStore`/`VectorStore`/`FtsStore` methods `async`. The SQLite adapter wraps its
synchronous calls in already-resolved promises (zero real cost). Migrate call
sites to `await` incrementally, **slice by slice**, behind a green test suite:

1. Vector read path (`vectorSearch`, `hybridSearch`, `commitSearch`) first —
   smallest, highest-value surface for pgvector/Qdrant.
2. Indexing write path (`blobStore`, `indexer`, `deduper`).
3. The long tail of analysis/temporal/clustering queries — these can keep using
   the SQLite session *directly* until a Postgres metadata backend needs them;
   they're guarded by "metadata backend = sqlite" until then.

- **Pros:** Mechanical, reviewable, reversible per slice. SQLite behavior is
  unchanged (sync under the hood). Lets pgvector/Qdrant land before the *entire*
  codebase is async.
- **Cons:** Large diff (lots of `await` threading). Mixed sync/async during the
  transition needs discipline (lint rule / typed boundary).

### Strategy B — **Keep CLI synchronous; async only behind the HTTP server**

Local CLI stays on synchronous SQLite. Postgres/Qdrant are reachable *only*
through gitsema's existing HTTP server (`gitsema tools serve` / `GITSEMA_REMOTE`),
which is already an async Express app and can talk to async backends internally.

- **Pros:** Near-zero churn in CLI/search/indexing call sites. Reuses the
  remote client/indexer plumbing that already exists. Ships a "team Postgres"
  story quickly.
- **Cons:** No *direct* local Postgres/Qdrant from the CLI — you always go
  through a server, even on `localhost`. Feels heavyweight for a solo dev who
  just wants their vectors in a local pgvector. Splits behavior ("some backends
  only via server") which is confusing.

### Strategy C — **Worker/sync-bridge for async backends**

Run async drivers in a worker thread and block the main thread via
`Atomics.wait` to preserve a synchronous facade.

- **Pros:** No call-site changes at all.
- **Cons:** Real complexity and fragility (serialization across the worker
  boundary, error propagation, connection pooling per worker), and it throws
  away async's actual benefit (concurrency). Not recommended; listed for
  completeness.

### Recommendation

**Strategy A.** It's the honest path: gitsema is going to be partly async
forever once Postgres/Qdrant exist, so make the seam async and migrate behind
tests. Strategy B is attractive as a *first deliverable* (ship team-Postgres via
the server while the CLI migration proceeds) and the two are compatible — we can
do B's server wiring early and A's CLI migration in parallel.

---

## 6. Proposed architecture (Option 1 + Strategy A)

### 6.1 Interfaces

New module `src/core/storage/` with backend-agnostic interfaces:

```ts
// src/core/storage/types.ts
export interface VectorStore {
  upsert(kind: VectorKind, items: VectorRecord[]): Promise<void>
  // ANN/topK search with metadata filters (model, branch, time, allowedHashes)
  search(kind: VectorKind, query: Float32Array, opts: VectorSearchOpts): Promise<VectorHit[]>
  delete(kind: VectorKind, ids: string[]): Promise<void>
  count(kind: VectorKind, model: string): Promise<number>
}

export type VectorKind = 'file' | 'chunk' | 'symbol' | 'module' | 'commit'

export interface MetadataStore {
  // relational surface: blobs, paths, commits, blob_commits, branches,
  // chunks, symbols, clusters, config, settings, repos…
  // (mirrors today's blobStore + query helpers, made async)
  // …the existing query helpers, behind one async seam
}

// keyword / BM25 store — independently pluggable, and OPTIONAL
export interface FtsStore {
  index(blobHash: string, content: string): Promise<void>
  search(query: string, limit: number): Promise<Bm25Hit[]>  // returns blob_hash + score
  delete(blobHashes: string[]): Promise<void>
}

export interface StorageProfile {
  metadata: MetadataStore
  vectors: VectorStore
  fts: FtsStore | null   // null ⇒ no keyword search; --hybrid reports unavailable
}
```

### 6.2 Table → store mapping

| Store | sqlite profile | postgres profile | qdrant profile |
|---|---|---|---|
| **MetadataStore** — blobs, paths, commits, blob_commits, branches, chunks, symbols (metadata), clusters meta, repos, tokens, config, settings, indexed_commits, checkpoints | SQLite tables | Postgres tables | **SQLite or Postgres** (companion) |
| **VectorStore** — file/chunk/symbol/module/commit embeddings | SQLite BLOB (+ usearch) | `vector` columns (pgvector, HNSW/IVFFlat) | Qdrant collections (one per kind) |
| **FtsStore** — keyword/BM25 (optional) | SQLite FTS5 | Postgres `tsvector` (or ParadeDB `pg_search`) | companion's FTS, an external engine, or `null` |
| query embedding cache, projections, blob_clusters centroid | SQLite BLOB | pgvector | stay in companion relational store (small, not worth Qdrant) |

> **Why the companion store for Qdrant:** Qdrant holds vectors + a small payload
> for filtering (model, blob_hash, branch, first_seen). Everything relational
> (commit graph, ownership, temporal joins) lives in the SQLite/Postgres
> companion, and keyword search lives in whatever `FtsStore` the profile names.
> This is the concrete form of the user's "some data is stored in db anyway."

### 6.3 `FtsStore` (BM25) per backend

The `FtsStore` seam isolates the part that differs most across backends. Scores
are normalized the same way `hybridSearch.ts` already does, so the vector⊕BM25
fusion math stays backend-independent.

- **sqlite:** unchanged FTS5 `bm25()`.
- **postgres:** `tsvector` + `ts_rank_cd` as a baseline; optionally ParadeDB's
  `pg_search` for true BM25 if available (the Phase 102 open question).
- **qdrant:** no native BM25 — pair with a companion `FtsStore` (FTS5/Postgres)
  or an external engine; or `null` for vector-only deployments.
- **future:** a dedicated engine (OpenSearch / Tantivy / Meilisearch) can be
  added as just another `FtsStore` implementation, touching nothing else.

### 6.4 Vector search per backend

- **sqlite:** keep today's behavior exactly (load → JS cosine, usearch
  prefilter). The SQLite `VectorStore.search` is a thin wrapper over the
  existing `vectorSearch.ts` internals.
- **pgvector:** push topK + filters into SQL (`ORDER BY embedding <=> $1 LIMIT
  k`), with HNSW index. Dequantization decision: store full Float32 in pgvector
  initially (simplest); quantization is a later optimization.
- **qdrant:** native ANN with payload filters (model/time). Re-rank /
  exact-cosine top candidates in JS if we need parity with SQLite scoring.

### 6.5 What lives *in* Qdrant — payload vs. companion

Qdrant does hold metadata, but only a deliberate slice. Each stored vector is a
**point** = `id + vector + payload`, where the payload is per-vector JSON you can
filter and return on. The rule: **put in the payload only what's needed to filter
the ANN query server-side or to identify the hit; everything else stays in the
companion `MetadataStore` and is fetched by `blob_hash` after search.**

**In the Qdrant payload:**
- `blob_hash` — identity / join key back to the `MetadataStore`.
- `model` — filter by embedding model.
- `first_seen` (immutable commit timestamp) — `--before`/`--after` time filtering.
- chunk/symbol points also carry `start_line`/`end_line` (+ `symbol_name`,
  `symbol_kind`, `language`) so a hit renders without a second round-trip.
- the vector *kind* (file/chunk/symbol/module/commit) is the **collection**
  itself — one collection per kind — not a payload field.

**Stays in the companion `MetadataStore`** (fetched by `blob_hash` post-search):
the commit graph, full path lists, branch membership, ownership, clusters —
everything relational, mutable, or many-to-many. Qdrant can't do the joins and
aggregations gitsema's analysis commands need, and duplicating mutable data into
payloads invites drift.

**Branch filtering is the judgment call.** Branch membership is mutable and
many-to-many (a blob joins new branches as history grows), so denormalizing it
into the payload would mean rewriting points. Instead, mirror the existing
`usearch` candidate-pool pattern: filter `model`+`first_seen` in Qdrant, pull a
**wider topK**, then post-filter by branch in JS against a companion lookup.
`first_seen` is safe to denormalize precisely because it is immutable for a
content-addressed blob.

---

## 7. Scoping & configuration model

### 7.1 New config keys (under existing `gitsema config` system)

```
storage.backend         sqlite | postgres | qdrant   preset wiring all three   (default: sqlite)
storage.scope           project | user | named                                 (default: project)
storage.metadata.url    file path | postgres://…      MetadataStore
storage.vectors.url     (e.g. qdrant) https://host…    VectorStore   (else inferred from preset)
storage.vectors.apiKey  vector store auth
storage.fts.backend     fts5 | tsvector | none | …     FtsStore      (else inferred from preset)
storage.fts.url         (external engine only)
storage.name            <named-index>                  when scope=named
```

`storage.backend` is a **preset** that picks sensible defaults for all three
stores (e.g. `qdrant` ⇒ Qdrant vectors + SQLite metadata + SQLite FTS). The
per-store keys override individual seams, so a power user can mix freely (e.g.
Postgres metadata + Qdrant vectors + `fts.backend=none`).

- **Resolution order** (unchanged precedence): env vars → repo `.gitsema/config.json`
  → user `~/.config/gitsema/config.json` → defaults.
- **Scope → default location:**
  - `project` → `./.gitsema/…` (today)
  - `user` → `~/.gitsema/…`
  - `named` → resolved purely from connection strings (no on-disk anchor)
- A single `resolveStorageProfile(cwd)` function replaces the scattered
  `DB_PATH` / `getActiveSession()` assumptions and becomes the *one* place that
  decides what `StorageProfile` a command runs against. This is also the natural
  home to retire the scattered path logic flagged in the architecture study.

### 7.2 Connection strings imply location

`storage.metadata.url = .gitsema/index.db` → local SQLite (today).
`storage.metadata.url = postgres://user@db.internal/gitsema` → remote Postgres.
`storage.vectors.url  = https://qdrant.internal:6333` → remote Qdrant.

No separate "local vs remote" flag needed — the URL scheme says it.

---

## 8. Consistency & portability

- **Indexing is idempotent and content-addressed**, so a partial write (e.g.
  metadata committed, Qdrant upsert failed, or FTS not yet written) self-heals on
  the next `index` run: the deduper sees the blob is missing its vector/FTS entry
  and re-processes only that one. We document this and add a `gitsema doctor`
  check that reports orphans across all three stores (metadata ↔ vector ↔ FTS).
- **`gitsema storage migrate --from <profile> --to <profile>`** (Phase 103):
  stream blobs/embeddings from one profile to another. Because identity is the
  blob hash, this is a straight copy with re-`upsert` into the target — no
  re-embedding required. This is the user's "freedom to move" guarantee.
- **Provenance:** `embed_config` already records model/dimensions/chunker;
  extend it (or `settings`) to record the active `storage.backend` so a mismatched
  reconnect is detected and explained rather than silently wrong.

---

## 9. Phased rollout

Three phases. The **async seam comes first** and is a prerequisite for the other
two; the two backend phases can then proceed in parallel since they implement
the same seam against different drivers. Each phase ends green
(`pnpm build && pnpm test`) and ships a changeset.

### Phase 101 — Async storage seam (foundation)

The big, mostly-mechanical phase. Ships **no new backend and no behavior
change** — it only relocates today's logic behind an async interface and makes
gitsema scope-aware.

- Introduce `src/core/storage/` (`MetadataStore`, `VectorStore`, `FtsStore`,
  `StorageProfile`) with **async** signatures (Strategy A, §5).
- Implement the **SQLite adapter** for all three interfaces wrapping today's
  code (sync calls returned as resolved promises — zero real cost; `FtsStore` =
  FTS5).
- Make the **vector read path** async: convert `vectorSearch`/`hybridSearch`/
  `searchCommits` to `async` and thread `await` through their callers (done).
  The **indexing write path** moves to Phase 102 (see below). Long-tail
  relational queries stay on the direct SQLite session (gated `metadata=sqlite`)
  until Phase 102 needs them.
- Add `storage.*` config keys, `resolveStorageProfile()`, and the
  `project`/`user`/`named` scope model (§7) — still SQLite-only, but now the
  *one* place that decides which index a command runs against.
- Add `withStorageProfile` test helper + the adapter-conformance suite skeleton.

### Phase 102 — Postgres metadata + pgvector

- **Route consumers through the profile** (carried over from 101): production
  call sites still invoke the now-async `vectorSearch`/`hybridSearch`/
  `searchCommits` *directly*. Point them at `profile.vectors.*` / `profile.fts.*`
  (via `resolveStorageProfile()` / `withStorageProfile()`) so the backend is
  actually swappable — otherwise pgvector would force `vectorSearch` itself to
  branch on backend, defeating the seam.
- **Indexing write-path migration** (moved from 101): route
  `blobStore`/`indexer`/`deduper` writes through the seam, including the
  cross-store transaction boundary (SQLite/Postgres commit blob + embedding +
  FTS atomically; Qdrant relies on idempotent re-index instead). Prerequisite
  for a *writable* Postgres backend.
- Postgres `MetadataStore` + Postgres `FtsStore` (`tsvector`/`ts_rank_cd` BM25,
  `pg_search` BM25 as opt-in).
- pgvector `VectorStore` (HNSW index, wider ANN candidate pool re-ranked by the
  existing JS three-signal ranking for parity).
- Postgres migrations, Docker compose for dev/CI service container.

### Phase 103 — Qdrant + portability/ops

- Qdrant `VectorStore` paired with a SQLite **or** Postgres metadata companion
  and `FtsStore` (collection-per-kind, payload filters, JS re-rank for parity).
- `gitsema storage migrate --from <profile> --to <profile>` (hash-keyed copy, no
  re-embedding — §8).
- `gitsema doctor` cross-store orphan checks; `gitsema status` reports the active
  backend; perf / when-to-use-what docs.

Phases 102 and 103 can run concurrently once 101 lands.

---

## 10. Testing strategy

- **Adapter conformance suite:** one shared test set run against every
  `VectorStore`/`MetadataStore` implementation (SQLite always; Postgres/Qdrant
  gated behind env / service availability in CI via service containers).
- **Parity tests:** identical query → ranked results must match SQLite within a
  tolerance for pgvector/Qdrant (ANN approximate, so top-k overlap, not exact).
- **Idempotency / heal tests:** simulate a half-failed write, re-`index`, assert
  the store converges.
- Keep `withDbSession`-style isolation; add `withStorageProfile` for tests.
- Postgres/Qdrant use ephemeral containers (mirrors the existing
  `mkdtempSync`/temp-repo integration pattern).

---

## 11. Risks & open questions

- **Diff size of Phase 101.** Threading `await` through search/indexing is large
  but mechanical; the long-tail relational queries can stay sync until a
  Postgres metadata backend needs them (gated). Mitigation: slice-by-slice PRs.
- **BM25 fidelity on Postgres.** `tsvector` ranking ≠ FTS5 BM25. Decide whether
  baseline `ts_rank_cd` is acceptable or we require ParadeDB `pg_search` for the
  Postgres profile. (Open question — leaning: ship `ts_rank_cd`, document the
  difference, offer `pg_search` as opt-in.)
- **Scoring parity with ANN backends.** pgvector/Qdrant return approximate
  neighbors; gitsema's three-signal ranking (vector + recency + path) currently
  assumes a full candidate set. Plan: fetch a wider ANN candidate pool, then run
  the existing JS ranking over it (same trick `--vss` already uses).
- **Quantization.** Start unquantized for pgvector/Qdrant; revisit once
  baseline works.
- **Multi-repo + new scopes.** Reconcile `storage.scope=named` with the existing
  `repos` registry / `GITSEMA_DATA_DIR` server storage so we don't end up with
  two overlapping "where's my index" mechanisms. (Open question for Phase 102.)

---

## 12. Non-goals (deferred)

- **No `ConfigStore` abstraction for now.** Config splits into two kinds that
  want different homes, and neither needs a new seam:
  - *User preferences / behavior knobs* (`provider`, `model`, search weights…)
    are **already JSON** files (`.gitsema/config.json` repo, `~/.config/gitsema/
    config.json` user), scope-aware and env-overridable via
    `src/core/config/configManager.ts`. Nothing to abstract.
  - *Index-describing facts* (`embed_config` provenance, `settings`) **must stay
    in the `MetadataStore`**, co-located and consistent with the index they
    describe. Pulling them into a separate JSON file would re-introduce the
    split-brain the store split exists to prevent (e.g. a shared remote Postgres
    index whose "what model built this?" lived in one laptop's JSON).
  - Key-value config also has no backend variety worth a pluggable seam (unlike
    vectors or BM25), so the cost (a fourth async interface + conformance tests)
    isn't justified.
- **Possible later:** a pluggable **config *provider*** inside `configManager.ts`
  — sourcing user config from somewhere other than local JSON (e.g. a remote
  config service or a merged fleet endpoint). That is a *config-loading* feature,
  not a storage backend, and is explicitly out of scope for Phases 101–103.

---

## 13. Changeset

Each phase adds a `minor` changeset (new capability), e.g. Phase 101:

```md
---
"gitsema": minor
---

Introduce a pluggable storage seam (MetadataStore / VectorStore / FtsStore)
behind the existing SQLite backend, with no behavior change — groundwork for
Postgres + pgvector and Qdrant backends.
```
