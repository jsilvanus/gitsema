# Chunk-Level Semantic Enrichment (summaries, keywords, entities) — Design Plan

**Status:** draft — refined from the `docs/feature-ideas.md` entry of the same
name (itself the salvaged Layer-1 kernel of the withdrawn
`docs/design/semantic-federation.md`; that doc's networking layers remain out
of scope and withdrawn).
**Target phases:** not yet scheduled. Next free PLAN.md phase numbers at time
of writing are 154+; note that 154–158 were briefly occupied by the withdrawn
federation track before removal, so the phase-plan step may prefer to start at
159 to keep history unambiguous.
**Scope:** an opt-in, LLM-generated metadata layer — `summary`, `keywords`,
optional `entities` — attached to the index's existing retrieval units
(whole-file blobs and chunks), stored as rows that **reference** the existing
blob/chunk/embedding rows (vectors are never duplicated; embeddings stay the
single source of truth), redacted **before storage**, and surfaced through the
existing search/first-seen/MCP/HTTP/guide result paths. **Out of scope:** any
networking or federation (withdrawn), the SKOS concept vocabulary (separate
feature-ideas entry; §8 records the interface reserved for it), symbol-level
enrichment (open question, §7), and lazy enrich-on-search (rejected, §3.3).

This refinement ran non-interactively, so every product/scope decision the
refine-idea flow would normally put to the user was taken autonomously from
codebase evidence and recorded in **§6 “Decisions taken autonomously (pending
user review)”**. Review §6 before turning this doc into PLAN.md phases.

---

## 1. Motivation

Search results, MCP tool output, and guide grounding today surface raw scores,
paths, line ranges, and (at best) a truncated head of raw content:

- `renderResults()` (`src/core/search/ranking.ts:53-74`) prints
  `score path [blob:hash] date :lines` — no description of *what the code is*.
- The only "snippet" in the system is `explainFormatter.ts`'s
  `content.slice(0, 200)` (`src/core/search/analysis/explainFormatter.ts:46`),
  a blind prefix of raw text.
- MCP tools and HTTP routes serialize the same `SearchResult` objects
  (`src/core/models/types.ts:21`), so agents receive hashes and scores, then
  must re-fetch and re-read full blob content to learn that a hit is, say,
  "the JWT validation middleware" — burning tokens on content the indexer
  already read and embedded once.

The indexer understands each unit of content exactly once (content-addressed,
CLAUDE.md design constraint #3). This design captures a small, durable,
human/LLM-readable distillation of that understanding at the same moment —
or in a later backfill pass — so every downstream consumer (CLI users, MCP
agents, the guide loop) gets a one-line answer to "what is this?" without
re-reading the content.

Hard requirements carried in from the feature-ideas entry:

1. Enrichment rows **reference** existing chunk/embedding rows. No vector is
   ever copied or recomputed; no blob content is duplicated.
2. LLM output passes through the existing redaction layer
   (`src/core/narrator/redact.ts`) **before storage** — stored summaries can
   later leave the machine (the Phase 54 bundle exports the whole `index.db`
   file verbatim, `src/cli/commands/bundleIndex.ts`; server routes return
   search results to remote clients).
3. The design covers the storage abstraction (`src/core/storage/`, all three
   backends), not just sqlite.
4. Enrichment uses the existing narrator/guide model infrastructure
   (Phase 91+, `gitsema models`), not a new provider stack.

---

## 2. Current state (verified against source)

| Claim | Evidence |
|---|---|
| The default chunker is `file` — most indexed repos have **no `chunks` rows at all**, only whole-file `embeddings` keyed `(blob_hash, model)` | `chunkerStrategy = 'file'` default and `useChunking = chunkerStrategy !== 'file'`, `src/core/indexing/indexer.ts:274,324`; CLAUDE.md `--chunker` default |
| Chunk rows are keyed by a **local autoincrement id**; only `(blob_hash, start_line, end_line)` is portable/content-stable | `chunks` table, `src/core/db/schema.ts:8-13`; `chunk_embeddings` PK `(chunk_id, model)`, `schema.ts:18-28` |
| All persisted reads/writes go through the async storage seam — `MetadataStore` / `VectorStore` / `FtsStore` / `GraphStore`; relational-only data already has a precedent (`structural_refs` lives on `MetadataStore.storeStructuralRefs`, and `GraphStore` throws on Qdrant profiles) | `src/core/storage/types.ts:91-120,216-247`; qdrant profile has **no metadata store of its own** — `src/core/storage/qdrant/` contains only `connection.ts`/`profile.ts`/`vectorStore.ts`, metadata+FTS come from the companion Postgres store |
| Postgres has its own idempotent migrations file that mirrors the sqlite tables | `CREATE TABLE IF NOT EXISTS chunks/chunk_embeddings`, `src/core/storage/postgres/migrations.ts:69-78` |
| The narrator model stack is complete and reusable: named configs in `embed_config` (`kind='narrator'/'guide'`), active-selection in `settings`, `resolveNarratorProvider()`, BYOK, CLI-subprocess backends | `src/core/narrator/resolveNarrator.ts` (config CRUD + `createNarratorProviderFor` + `resolveNarratorProvider`); `NarratorProvider.narrate({systemPrompt,userPrompt,maxTokens}) → {prose,tokensUsed,redactedFields,llmEnabled}`, `src/core/narrator/types.ts:13-42` |
| **Outbound** redaction is already enforced inside the providers (prompts are redacted before leaving the process), with fired patterns returned and audited | `redactedUser`/`redactedSystem` + `withAudit('narrate', …, allFired, fn)`, `src/core/narrator/chattydeerProvider.ts:95-140`; `redact()`/`redactAll()`, `src/core/narrator/redact.ts:103-130`; `withAudit`, `src/core/narrator/audit.ts:51` (operation type is currently `'narrate' \| 'explain'`) |
| **No inbound redaction exists** — LLM *responses* are returned to the caller as prose and never stored, so nothing today redacts model output. Storing summaries makes inbound redaction a new, mandatory step | absence of any `redact` call on `result.explanation` in `chattydeerProvider.ts:116-124`; grep for `redact` shows only prompt-side call sites |
| Search results are assembled in one place — paths + first-seen are batch-joined onto the top-K entries; this is the natural join point for enrichment fields | result-assembly block, `src/core/search/analysis/vectorSearch.ts:540-600` (`pathsByBlob`, `getFirstSeenMap`, `SearchResult` construction with `chunkId`/`startLine`/`endLine`) |
| MCP and HTTP serialize `SearchResult` objects as JSON — new optional fields propagate to both interfaces with zero per-tool work | `serializeSearchResults`, `src/mcp/registerTool.ts:6`; `res.json({ blobResults, commitResults })`, `src/server/routes/search.ts:344-347` |
| The CLI text renderer is the only surface that needs an explicit change to *show* new fields | `renderResults`, `src/core/search/ranking.ts:53-74` |
| Post-pass maintenance subcommands over an existing index are an established pattern | `index update-modules`, `index rebuild-fts`, `index build-vss` (CLAUDE.md command table) |
| Per-blob error tolerance is the indexing convention — provider failures are caught per unit and counted in stats, never fatal | chunk-embed catch + `stats` counters, `src/core/indexing/indexer.ts:859-880`; CLAUDE.md "Error handling" |
| `index export` copies the whole `index.db` into the bundle — any new table (and any secret stored in it) automatically leaves the machine with the bundle | `src/cli/commands/bundleIndex.ts:1-60` |
| Tool-surface conventions: usage lives in `GUIDE_TOOLS` descriptions + MCP `registerTool` descriptions; result-reading guidance lives in `TOOL_INTERPRETATIONS`; `pnpm gen:skill` regenerates the skill and a `docsSync` test enforces `GUIDE_TOOLS ⊆ TOOL_INTERPRETATIONS` | header of `src/core/narrator/interpretations.ts:1-39`; CLAUDE.md "Tool interpretations" |
| Current sqlite schema version is **32**; this design adds **v33** | CLAUDE.md schema table; `CURRENT_SCHEMA_VERSION` in `src/core/db/sqlite.ts` |

**Conclusion:** every ingredient except two already exists — the missing
pieces are (a) an *inbound* redaction step (LLM output → storage) and (b) a
place to put the metadata. Everything else is composition: narrator providers
for the calls, the storage seam for persistence, the single result-assembly
site for surfacing, and additive JSON fields for MCP/HTTP parity.

---

## 3. Conceptual model & options considered

Enrichment is a function `enrich(unit) → {summary, keywords, entities?}`
applied at most once per `(unit, enricher-model)` pair — the same
"embedded exactly once" invariant that governs vectors (CLAUDE.md design
constraint #3), applied to a second, cheaper artifact. Four axes had real
alternatives.

### 3.1 Axis A — What is a "unit"? (granularity)

| Option | Pros | Cons |
|---|---|---|
| **A1. Chunks only** (the idea's title) | Matches the federation design's Layer-1 sketch; finest-grained summaries | The default chunker is `file` → **no chunk rows exist** for most repos (§2 row 1); the feature would be a silent no-op for the default configuration |
| **A2. Whole-file blobs only** | Covers the default path; simplest keying (`blob_hash`) | Chunked repos (function/fixed) lose the fine-grained "JWT validation handler, lines 42–87" value that motivated the idea |
| **A3. Retrieval units: file-level always, chunk-level when chunk rows exist** ✅ | Covers both realities; mirrors exactly what search can return (`SearchResult.kind` is `file`/`chunk`); one table serves both | Slightly wider schema (nullable line range) |
| A4. Also symbols/modules/commits | Maximal coverage | Cost multiplies; symbols already carry a human-readable identity (`qualifiedName(signature)`, Phase 105) which *is* a summary of sorts; modules/commits have other mechanisms (`module_embeddings` centroids, commit messages). Deferred (§7) |

**Chosen: A3.** A unit is either a whole-file blob (`blob_hash`, lines NULL)
or a chunk (`blob_hash`, `start_line`, `end_line`). The chunk key
deliberately uses the **portable content coordinates** rather than the local
autoincrement `chunk_id` (§2 row 2), so enrichment rows survive
`index export`/`import` and are joinable in every backend.

### 3.2 Axis B — Where does it live? (schema)

| Option | Pros | Cons |
|---|---|---|
| B1. Nullable columns on `chunk_embeddings` (the federation sketch's "extend chunk_embeddings" idea) | No new table | Cannot represent file-level units (A3); mutates rows that constraint #3 treats as immutable; couples enrichment lifetime to one embedding model's rows; Qdrant stores vectors *outside* Postgres — there is no `chunk_embeddings` row to put a column on in that profile |
| B2. Content-addressed `semantic_objects` table duplicating `embedding BLOB` per object (the withdrawn federation schema, `semantic-federation.md:88-104`) | Self-contained envelope | **Violates the no-vector-duplication hard requirement**; existed to serve gossip/packfiles that are withdrawn |
| **B3. New `enrichments` table that references existing rows** ✅ | File+chunk units in one place; vectors untouched; multiple enricher models can coexist (keyed per model, like every embedding table); relational-only → trivially portable to Postgres; rides along in bundles automatically | One new table + v33 migration in two backends |

**Chosen: B3.**

```
enrichments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,   -- (BIGSERIAL in Postgres)
  blob_hash     TEXT NOT NULL REFERENCES blobs(blob_hash),
  start_line    INTEGER,          -- NULL, NULL  = whole-file unit
  end_line      INTEGER,          -- both set    = chunk unit (1-indexed, inclusive)
  model         TEXT NOT NULL,    -- enricher model-config NAME (embed_config.model)
  summary       TEXT NOT NULL,    -- redacted; target <= ~200 chars
  keywords      TEXT NOT NULL,    -- redacted; JSON array of normalized strings, <= 10
  entities      TEXT,             -- redacted; JSON array of {name, kind}, <= 10; NULL if none
  redacted_fields TEXT NOT NULL,  -- JSON array of fired redaction pattern names ([] if clean)
  tokens_used   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL  -- unix seconds
)
UNIQUE INDEX idx_enrichments_unit ON (blob_hash, COALESCE(start_line, -1), COALESCE(end_line, -1), model)
INDEX idx_enrichments_blob ON (blob_hash)
```

(Drizzle cannot express the `COALESCE` unique index directly; the sqlite
migration creates it with raw SQL, the same escape hatch existing migrations
use. Postgres gets the identical expression index in
`storage/postgres/migrations.ts`.)

- `model` stores the **config name** (`embed_config.model` for
  `kind='narrator'/'guide'` rows), matching how `resolveNarrator.ts` names
  configs. Two different enricher models can each enrich the same unit; reads
  prefer the currently-resolved enricher and fall back to the most recent row
  (§4.4).
- `redacted_fields` persists which redaction patterns fired on the *stored*
  output — the audit-visibility analogue of `NarrateResponse.redactedFields`.
- **No FTS row is written for summaries in v1** — see §7 (open question:
  hybrid search over summaries).

**Storage-seam coverage (hard requirement 3):** enrichment is relational
metadata, so it extends `MetadataStore` (`src/core/storage/types.ts`) — the
exact pattern `structural_refs` used (§2 row 3):

```ts
/** A stored (or to-be-stored) enrichment row for one retrieval unit. */
export interface EnrichmentRecord {
  blobHash: string
  startLine?: number      // both unset = whole-file unit
  endLine?: number
  model: string           // enricher config name
  summary: string         // already redacted by the caller
  keywords: string[]      // already redacted + normalized by the caller
  entities?: Array<{ name: string; kind: string }>
  redactedFields: string[]
  tokensUsed: number
}

interface MetadataStore {
  // ... existing methods ...
  /** Upserts one enrichment row (unique per unit+model). */
  putEnrichment(rec: EnrichmentRecord): Promise<void>
  /** Batch lookup for result assembly: all enrichments for these blobs, optionally one model. */
  getEnrichments(blobHashes: string[], model?: string): Promise<EnrichmentRecord[]>
  /** Units (file- and chunk-level) lacking an enrichment for `model`; limited for backfill batching. */
  listUnenrichedUnits(model: string, opts?: { limit?: number; ext?: string[] }): Promise<Array<{ blobHash: string; startLine?: number; endLine?: number }>>
  /** Row count, optionally per model — feeds `gitsema status` / `index doctor`. */
  countEnrichments(model?: string): Promise<number>
}
```

Backend coverage: **sqlite** implements against the v33 table; **postgres**
implements against its mirrored table; **qdrant** profiles are covered *by
construction* — their `MetadataStore` **is** the companion Postgres store (§2
row 3), so no qdrant-specific code exists, and unlike `GraphStore` nothing
needs to throw. `storage migrate` copies the table like any other metadata
table (sqlite→postgres/qdrant paths gain it in the same phase as the
migration).

### 3.3 Axis C — When does enrichment run? (trigger & cost model)

| Option | Pros | Cons |
|---|---|---|
| C1. Always-on at index time | Zero extra commands | Violates safe-by-default: indexing would silently call an LLM; cost surprise on large histories |
| **C2. Opt-in at index time (`--semantic-enrich`) + explicit backfill (`index enrich`)** ✅ | Explicit consent to every LLM call (matches `narrate`/`explain`'s evidence-only-by-default posture); backfill covers already-indexed repos; dedup makes both resumable | Two entry points to document |
| C3. Lazy enrich-on-first-search-hit | Pay only for what's read | **Rejected:** read paths (`search`, MCP tools, HTTP GET routes) are network-free-and-fast today; a search that sometimes blocks on N LLM calls (and *writes* to the DB) breaks that contract and the safe-by-default rule. Revisit only if eager cost proves prohibitive (§7) |
| C4. "Top-N by search demand" scoring | Focuses spend | Requires a query-log/popularity mechanism that doesn't exist; premature. The `--enrich-max` cap + backfill `--limit` give the operator the same lever manually |

**Chosen: C2**, with these cost controls (resolving Design Gap 1):

- **Dedup is the primary control.** A `(unit, model)` pair is enriched at
  most once, ever — checked against the unique index before any LLM call,
  exactly like `deduper.ts` for embeddings. Content-addressing means
  unchanged files across commits/branches never re-enrich.
- **Per-run cap:** `--enrich-max <n>` (default: unlimited) stops issuing new
  LLM calls after n units; combined with dedup this gives free
  **resumability** — rerunning continues where the cap stopped, no
  checkpoint table needed.
- **Scope inheritance:** index-time enrichment applies to exactly the units
  the run indexes (so `--ext`, `--exclude`, `--include-glob`, `--max-size`
  all constrain it for free); backfill takes its own `--ext`/`--limit`.
- **Concurrency:** a separate `p-limit` pool, `--enrich-concurrency`
  (default **2**) — LLM calls are slower and pricier than embedding calls;
  reusing the embedding `--concurrency` (default 4) would double-dip the
  same budget.
- **Batching:** one unit per LLM call. A multi-unit-per-prompt variant
  (k units in, k JSON objects out) was considered and rejected for v1:
  chat-completions output attribution is fragile (one malformed element
  poisons the whole batch) and per-unit token accounting/auditing gets
  muddy. Recorded in §7 as a cost optimization to revisit.
- **Truncation:** unit content sent to the LLM is capped (first ~6 KB —
  aligned with `--max-size`'s spirit; summaries of a file's head are
  acceptable, blown context windows are not).
- **Dry-run:** `index enrich --dry-run` prints unit counts (and units-per-
  model breakdown) without calling anything.

### 3.4 Axis D — Which model, and how is output handled?

**Model resolution (resolving the "narrator plumbing" prerequisite, no new
subsystem):** reuse `resolveNarratorProvider()` untouched. Resolution order
for the enricher: explicit `--enrich-model <name>` (a named `embed_config`
narrator/guide config) → the **active narrator config** → hard error with
the `gitsema models add … --narrator … --activate` hint. No silent skip: the
user explicitly opted in with `--semantic-enrich`, so "no model configured"
is an error, not a no-op. **No new `kind` in `embed_config`** — an
"enricher" is just a narrator-shaped model used for a different prompt;
adding a fourth kind would ripple through `models` CLI/MCP/HTTP for zero
expressiveness gain. (BYOK: server-side enrichment is out of scope in v1 —
§6 D11 — so the BYOK path doesn't arise.)

**Output contract:** the system prompt requests **strict JSON**
`{"summary": string, "keywords": string[], "entities": [{"name","kind"}]}`
with hard limits (summary ≤ 200 chars target; ≤ 10 keywords; ≤ 10 entities;
entity `kind` ∈ `framework | protocol | service | domain | other`). The
response is parsed defensively (strip code fences, find first `{`…last `}`);
on parse failure retry **once** with a "JSON only" reminder; a second
failure counts the unit in `stats.enrichFailed` and moves on — the
per-blob non-fatal error convention (§2 row 11).

**Redaction (hard requirement 2) — both directions:**

1. *Outbound* — already handled inside every `NarratorProvider` (§2 row 6);
   nothing to add.
2. *Inbound (new)* — after parsing, `redact()` is applied to the summary,
   every keyword, and every entity name **before** the `putEnrichment()`
   call. Fired pattern names from both directions are merged into
   `redacted_fields`. This is belt-and-braces on purpose: even though the
   input was redacted, an LLM can reconstruct or hallucinate secret-shaped
   strings, and this table ships in bundles and server responses verbatim.
3. *Audit* — each call is wrapped in `withAudit('enrich', …)`
   (`audit.ts`'s operation union gains `'enrich'`), so the existing
   `[llm_audit]` log line covers enrichment traffic.

**Keyword normalization (resolving Design Gap 4):** freeform terms,
normalized at write time — lowercased, trimmed, internal whitespace
collapsed to single spaces, deduplicated, each ≤ 40 chars, ≤ 10 kept. **No
concept-vocabulary references now.** The SKOS idea (feature-ideas.md) gets a
clean seam anyway: a future `concept_assignments` table would reference
enrichment rows by their `id` — nothing in *this* schema pre-commits to
that, which is exactly the "reserve by not entangling" posture the withdrawn
federation postmortem argued for.

---

## 4. Chosen direction — end-to-end shape

### 4.1 New module: `src/core/enrichment/`

```
src/core/enrichment/
  enricher.ts    — enrichUnit(provider, unitContent, meta) → parsed+redacted EnrichmentRecord
                   (prompt build, JSON parse w/ one retry, inbound redact, withAudit('enrich'))
  prompts.ts     — system prompt + JSON contract (kept out of enricher.ts for testability)
  backfill.ts    — runEnrichBackfill(profile, provider, opts) — drives listUnenrichedUnits →
                   git cat-file content fetch (showBlob / line-slice for chunks) → enrichUnit →
                   putEnrichment, under p-limit(--enrich-concurrency)
```

It imports `resolveNarratorProvider` from `narrator/` but lives outside it —
`narrator/` stays about narrate/explain/guide prose; enrichment is an
indexing-side pipeline. Content for backfill comes from Git (`showBlob`,
constraint #1: Git is the source of truth), *not* from `blob_fts` (which is
optional — `fts: null` profiles must still backfill).

### 4.2 Index-time path (`gitsema index start --semantic-enrich`)

In `indexer.ts`, immediately after a unit's embedding write succeeds
(`writeFileBlob` for file units at :741/:829; the chunk `upsert` at :873),
the unit is queued to the enrichment pool. Enrichment failures never fail
the blob (it is already indexed); they increment `stats.enrichFailed`. New
stats: `enriched`, `enrichSkipped` (dedup hits), `enrichFailed`,
`enrichTokens`. Flags: `--semantic-enrich`, `--enrich-model <name>`,
`--enrich-max <n>`, `--enrich-concurrency <n>`.
`--semantic-enrich` + `--remote` errors out in v1 (§6 D11).

### 4.3 Backfill path (`gitsema index enrich`)

New maintenance subcommand (precedent: `index update-modules`,
`index rebuild-fts`): resolves the enricher model, then enriches every
already-indexed unit missing a row for that model. Flags: `--model <name>`,
`--limit <n>`, `--ext <exts>`, `--concurrency <n>`, `--dry-run`, `-y`.
Resumable by construction (dedup); safe to re-run; exit code contract:
plain 0/1 (not a gate). This resolves Design Gap 2.

### 4.4 Surfacing (read path)

- `SearchResult` (`src/core/models/types.ts`) gains optional fields:
  `summary?: string`, `keywords?: string[]` (entities intentionally not
  surfaced in results v1 — niche until a consumer exists; they remain
  queryable in the table).
- Attachment happens at the single assembly site
  (`vectorSearch.ts:540-600`): one batched
  `getEnrichments(blobHashes, resolvedModel)` alongside the existing
  paths/first-seen joins; file-kind results match rows with NULL lines,
  chunk-kind results match on `(blobHash, startLine, endLine)`. Model
  preference: the currently-resolved enricher config name if one is
  configured, else the most recent row per unit. Missing enrichment ⇒
  fields absent (never an error, never an LLM call — reads stay
  network-free).
- **CLI/REPL:** `renderResults()` prints an indented `↳ summary
  [kw1, kw2, …]` line under each enriched result. No flag needed to enable;
  a `--no-enrich` display flag is *not* added (one indented line is cheap;
  flags are not).
- **MCP + HTTP:** zero per-tool work — the new optional fields flow through
  `serializeSearchResults` and the routes' `res.json(...)` automatically
  (§2 rows 8–9). Additive JSON fields; no breaking change (parity.md §4's
  break-if-needed license is not needed here).
- **Guide:** search-family `GUIDE_TOOLS` results inherit the fields the same
  way (they serialize `SearchResult`s), which is the actual token-saving
  win: the agent reads the summary instead of calling a content fetch.
- **Parity surface for the new verb:** `index enrich` gets an MCP tool
  `enrich` (args: `model?`, `limit?`, `ext?`, `dry_run?`) and HTTP
  `POST /enrich`, mirroring how the `index` MCP tool exposes re-indexing;
  guide gets the same tool in the `admin` category, index-gated and
  LLM-gated (returns `{error}` when no index / no model, per convention).
- **Conventions compliance:** `TOOL_INTERPRETATIONS` gains an `enrich`
  entry, and the entries for `semantic_search` / `search_history` /
  `first_seen` / `code_search` get one added sentence describing the
  optional `summary`/`keywords` fields and their caveat ("LLM-generated,
  redacted, may be stale relative to a re-chunked config"); then
  `pnpm gen:skill` regenerates the skill and the `docsSync` test pins it.
- **Status/health:** `gitsema status` reports enrichment coverage
  (`countEnrichments` vs unit counts, per model); `index doctor` gains a
  check for orphan enrichments (rows whose blob/unit no longer exists —
  e.g. after `index gc`) and `index gc` deletes enrichments for collected
  blobs.

### 4.5 What is deliberately NOT built

- No new vector, no re-embedding, no second source of semantic truth —
  ranking is untouched; enrichment is presentation/grounding metadata only.
- No FTS row for summaries (yet — §7).
- No enrichment of symbols/modules/commits (§7).
- No lazy enrichment in read paths (§3.3, rejected).
- No new `embed_config` kind, no new provider class, no new daemon, no
  networking of any sort.

---

## 5. Phased implementation plan

Sized like existing PLAN.md phases; each phase independently shippable,
each ends with docs (features.md, README command tables, parity.md where
tool surfaces change, deprecations.md n/a) + a changeset (`minor`).

### Phase E1 — Enrichment core + storage + backfill (the CLI-first slice)

- Schema **v33**: `enrichments` table + indexes in `src/core/db/schema.ts` +
  migration in `sqlite.ts`; mirrored `CREATE TABLE IF NOT EXISTS` in
  `src/core/storage/postgres/migrations.ts`; `storage migrate` copies it.
- `MetadataStore` gains `putEnrichment` / `getEnrichments` /
  `listUnenrichedUnits` / `countEnrichments` (sqlite + postgres
  implementations; qdrant covered via companion Postgres).
- `src/core/enrichment/{enricher,prompts,backfill}.ts` — prompt/JSON
  contract, one-retry parse, **inbound redaction**, `withAudit('enrich')`
  (extend the operation union in `audit.ts`).
- `gitsema index enrich` subcommand (`--model`, `--limit`, `--ext`,
  `--concurrency`, `--dry-run`, `-y`).
- Tests: unit (JSON parse edge cases; normalization; inbound redaction with
  a summary containing a planted `sk-…` key; unit-key matching incl. the
  COALESCE unique index) + integration (temp repo, mock narrator provider,
  backfill twice ⇒ second run is a full dedup no-op; `rawDb.close()` before
  `rmSync` per the Windows CI rule).
- **Effort: the largest of the three — schema + seam + engine (~medium).**

### Phase E2 — Index-time enrichment (`--semantic-enrich`)

- `--semantic-enrich`, `--enrich-model`, `--enrich-max`,
  `--enrich-concurrency` on `index start`; enrichment pool wired after the
  embedding writes in `indexer.ts`; new stats counters in the run summary;
  `--remote` incompatibility error.
- Tests: integration run with `--chunker file` and `--chunker fixed`
  (file-level vs chunk-level units), cap behavior (`--enrich-max 3` then
  rerun resumes), failure counting with a provider that errors on the 2nd
  call.
- **Effort: small (plumbing into an existing pipeline).**

### Phase E3 — Surfacing & interface parity

- `SearchResult.summary`/`keywords` + assembly-site join
  (`vectorSearch.ts`); `renderResults` indented line; verify MCP/HTTP
  passthrough (supertest + MCP tool tests asserting field presence).
- `enrich` MCP tool + `POST /enrich` route + guide tool;
  `TOOL_INTERPRETATIONS` entries (new `enrich`, amended search-family);
  `pnpm gen:skill`; `docs/parity.md` matrix row for `enrich` and flag-parity
  notes; `status` coverage line; `index doctor` orphan check + `index gc`
  cleanup.
- **Effort: small–medium, mostly breadth (parity checklist).**

---

## 6. Decisions taken autonomously (pending user review)

This refinement ran non-interactively; the following would normally have
been clarifying questions. Each is reversible before phase-planning.

| # | Decision | Rationale |
|---|---|---|
| **D1** | Units are **whole-file blobs AND chunks** (§3.1 A3), despite the idea's "chunk-level" title | The default chunker is `file` — chunk-only enrichment would no-op for default-configured repos (`indexer.ts:274,324`). Enriching exactly the set of things search can return keeps the feature aligned with its consumer |
| **D2** | **New `enrichments` table**, not columns on `chunk_embeddings` (§3.2 B3) | Columns can't represent file-level units; embedding rows are treated as immutable (constraint #3); Qdrant profiles have no relational `chunk_embeddings` row to extend; per-model coexistence needs its own key |
| **D3** | Chunk units keyed by **(blob_hash, start_line, end_line)**, not `chunk_id` | `chunk_id` is a local autoincrement — not portable across `export`/`import` or backends; content coordinates are stable for immutable blob content |
| **D4** | Storage seam = **new methods on `MetadataStore`** (no fourth store interface) | Enrichment is plain relational metadata; `structural_refs` set this exact precedent (`types.ts:119`); a dedicated `EnrichmentStore` would add interface surface for four methods |
| **D5** | **Eager opt-in + backfill only; lazy enrich-on-search rejected** (§3.3) | Read paths are network-free and fast today; silently calling an LLM (and writing) inside `search` breaks the repo's safe-by-default posture (`narrate`/`explain` evidence-only precedent) |
| **D6** | **Reuse narrator configs; no new `embed_config` kind, no new flag on `models`** | `resolveNarratorProvider` already does config CRUD/activation/BYOK; an enricher differs from a narrator only in prompt. Resolution: `--enrich-model <name>` → active narrator config → hard error (opt-in must not silently no-op) |
| **D7** | **Inbound redaction is mandatory and recorded** — `redact()` on summary/keywords/entities before `putEnrichment`, fired patterns persisted in `redacted_fields` | Hard requirement; providers only redact outbound today (`chattydeerProvider.ts:95-140`); bundles copy the whole DB (`bundleIndex.ts`), so stored text must already be clean |
| **D8** | **Strict-JSON contract, one retry, then non-fatal per-unit failure** | Matches the indexer's per-blob error convention (`indexer.ts:859-880`); a flaky LLM must not fail an indexing run |
| **D9** | **Keywords freeform + normalized** (lowercase/trim/dedup/≤10/≤40 chars); no SKOS references reserved in-schema (Design Gap 4) | SKOS is a separate undesigned idea; a future assignment table can reference `enrichments.id` without this schema pre-committing to anything |
| **D10** | Cost controls = **dedup + `--enrich-max` + separate `--enrich-concurrency` (2) + per-unit calls + ~6 KB content cap**; no popularity-based selection; resumability via dedup, no checkpoint table (Design Gap 1) | Dedup mirrors the embeddings invariant and makes reruns free; demand-based selection needs query-log infra that doesn't exist; multi-unit batching rejected for attribution fragility (revisit in §7) |
| **D11** | **`--semantic-enrich` is incompatible with `--remote` in v1** (hard error); server-side enrichment deferred | Remote indexing delegates embedding to a server whose model set/BYOK rules are governed by locked-model-set-plan.md; designing server-side enrichment now would re-entangle this with that track — the exact mistake the withdrawn federation design made |
| **D12** | Surfacing is **additive** (optional `summary`/`keywords` on `SearchResult`, always attached when present, no toggle flag); entities stored but not surfaced in results v1 | Additive JSON breaks no interface (parity.md §4 escape hatch unneeded); a display toggle is flag noise; entities have no consumer yet |
| **D13** | Doc filename `docs/semantic-enrichment-plan.md` | Matches the dominant recent precedent family (`storage-backends-plan.md`, `locked-model-set-plan.md`, `multi-tenant-auth-plan.md`, `public-repo-sharing-plan.md`) for infra-shaped, phase-ready designs |

---

## 7. Remaining open questions (genuinely deferred)

1. **FTS over summaries.** Writing summaries into the FTS store (a separate
   namespace or a joined document) could boost `--hybrid` recall ("what does
   this do"-shaped queries match summaries better than code tokens). Needs
   an `eval`-harness measurement before committing — and a decision about
   `fts: null` profiles. Extension phase candidate.
2. **Batched multi-unit prompts.** Could cut per-call overhead severely on
   large backfills; rejected for v1 (attribution fragility, §3.3). Revisit
   with real cost data from E1/E2 usage.
3. **Symbol-level enrichment.** Symbols already carry
   `qualifiedName(signature)`; whether an LLM summary adds enough over that
   to justify the spend is unproven. If added later it is one more unit
   shape in the same table (symbol coordinates), not a redesign.
4. **Server-side enrichment for `tools serve` / remote indexing** (D11).
   Interacts with the locked-model-set allow-list and BYOK never-persist
   rules; design alongside that track when demand exists.
5. **On-demand enrichment** (rejected for v1, §3.3) — only revisit if eager
   cost proves prohibitive in practice, and then only behind an explicit
   `--enrich-on-read`-style opt-in with a write-path budget.
6. **SKOS concept vocabulary linkage** — separate feature-ideas entry;
   `enrichments.id` is the anchor a future assignment table would use.

---

## 8. Relationship to the withdrawn federation design

This doc deliberately keeps the *only* part of
`docs/design/semantic-federation.md` Layer 1 that was valuable without a
network: the metadata envelope. Differences from that sketch, on purpose:

- **No `semantic_objects` content-addressed envelope, no embedded vector
  copy, no signer field** — those existed to serve gossip/packfile exchange
  (withdrawn). Enrichment rows reference; they do not envelop.
- **No `profile_version`/`model_dimensions` duplication** — embedding
  provenance already lives in `embed_config` and the per-row `model`
  columns; repeating it here would create a second source of truth.
- **`language`/`structural_refs` fields dropped** — `embeddings.file_type`
  and the `structural_refs` table (Phase 106) already store them.
- What survives: chunk-level granularity (extended to file-level units for
  the default chunker), `summary`/`keywords`/`entities`, and the
  "summaries travel where vectors are too heavy" insight — which here means
  bundles and API responses rather than gossip, and is exactly why
  redaction-before-storage is non-negotiable.
