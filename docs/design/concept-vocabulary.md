# Design Doc — SKOS-Style Concept Vocabulary (model-independent semantic layer)

> Status: **draft — refined from `docs/feature-ideas.md`, not yet scheduled.**
> Target phases: **unassigned** (labeled C1–C5 below; real numbers are assigned
> when this is promoted into `docs/PLAN.md`).
> Scope: a lightweight, curated, **model-independent** controlled vocabulary
> (SKOS-subset semantics in plain relational tables) mapped onto gitsema's
> existing artifacts — blobs, chunks, symbols, clusters — with a faceted query
> surface at CLI/MCP/HTTP parity.
>
> Provenance: salvaged from the withdrawn semantic-federation design's
> keyword/SKOS thread (`docs/design/semantic-federation.md`, ⛔ withdrawn —
> background reading only). This document stands alone and does **not** depend
> on any part of that design.

This document nails down the **conceptual model**, the **SKOS subset**, the
**schema**, the **curation workflow**, the **assignment mechanics and
confidence model**, the **query surface**, and the **phase boundaries** before
any code lands. PLAN.md phase entries should link here rather than restating
the design (same convention as `docs/knowledge-graph.md`).

---

## 1. Motivation & relationship to what exists

Everything semantic in gitsema today lives in **one embedding model's vector
space**. Vectors from different models are incomparable — which is exactly why
the withdrawn federation design had to forbid cross-model exchange and defer
"cross-space similarity" to open research, and why the locked-model-set work
(Phase 128, `repos.profile_name`) pins a repo to the profile it was first
indexed with. Meanwhile, every human-readable *label* gitsema produces is
ad-hoc and unstable:

- **Cluster labels** (`blob_clusters.label`) are derived from term frequency +
  path prefixes (`src/core/search/clustering/clustering.ts`,
  `labelEnhancer.ts` TF-IDF). They are **not stable across runs**: `kMeansInit`
  seeds with `Math.random()`, and each `computeClusters` run does
  `DELETE FROM cluster_assignments; DELETE FROM blob_clusters` and re-inserts
  under fresh autoincrement IDs. The same codebase clustered twice yields
  different cluster identities and possibly different labels.
- **"Concept" is not a persisted entity anywhere.** The word appears zero
  times in `src/core/db/schema.ts`. `concept-evolution`, `dead-concepts`,
  `lifecycle`, `change-points`, `bisect`, `author` all define a "concept" as
  an **ephemeral query string** embedded at call time and compared by cosine
  similarity. Nothing survives the call.
- **Keywords** (`blob_clusters.top_keywords`, FTS tokens) are freeform strings
  with no relations, no synonyms, no hierarchy.

What is missing is a **model-independent semantic layer**: a small, curated
vocabulary of *concepts* with SKOS-ish structure (`broader` / `narrower` /
`related`, preferred + alternative labels), mapped onto the artifacts gitsema
already indexes. The defining property: **concepts are identified by curated
keys and labels, never by vectors**, so two repos indexed with *different
embedding models* — or the same repo re-indexed under a new model — still
interoperate at the concept layer ("both have material under
`auth > token-refresh`"). The cross-model problem that is unsolvable at the
vector layer simply dissolves one level up. This is the principled foundation
for any future cross-repo/cross-model feature.

Concretely, the vocabulary enables:

- **Faceted search** — `gitsema search "refresh handler" --concept auth/jwt`
  restricts results to material assigned to a concept (and its narrower
  descendants).
- **Stable topic labels** — clusters come and go per run; a cluster can be
  *mapped to* concepts, giving a stable name that survives re-clustering and
  re-indexing.
- **Concept-level diffs** — "between v1.0 and v2.0, material under
  `payments/webhooks` doubled; `legacy/soap` disappeared" (a future phase
  builds this on assignments × `blob_commits`, the same join `first-seen`
  uses).
- **A curated map of what the codebase is about** — browsable, exportable,
  versionable alongside the code.

### Constraints this design must respect (from `CLAUDE.md`)

1. **Git is the source of truth** for code facts. The vocabulary is *human/LLM
   knowledge about* the code — the one legitimately non-Git-derived layer —
   but assignments to code always target Git-native identities (blob hashes).
2. **Blob-first.** Assignments pivot on `blob_hash` (and blob-derived chunk /
   symbol occurrence identities), never on paths or commits. A useful
   consequence: blob-level assignments are **content-addressed** — the same
   file content in two repos (or at two paths) carries its concept assignments
   with it for free.
3. **Streaming.** Automated assignment passes iterate the index in bounded
   batches; never load all content into memory.
4. **CLI-first; MCP/HTTP thin.** All logic in `src/core/concepts/`; MCP tools
   and HTTP routes wrap the same functions.
5. **Storage seam.** The vocabulary lives in the **relational** store, behind
   a new `ConceptStore` interface on `StorageProfile` — following the
   `GraphStore` precedent, including the fail-loud
   `UnsupportedConceptStore` for non-relational profiles
   (cf. `src/core/storage/unsupportedGraphStore.ts`).

---

## 2. Grounding: the SKOS subset we adopt (and what we skip)

The design borrows real [SKOS](https://www.w3.org/TR/skos-reference/)
semantics so the vocabulary is interoperable-by-construction with external
taxonomies, but the implementation is **a set of SQLite tables, not an RDF
triple store**. The mapping:

| SKOS construct | Adopted as | Notes |
|---|---|---|
| `skos:ConceptScheme` | `concept_schemes` row | A named vocabulary. One default scheme per index; imported schemes are additional rows. Scheme `uri` gives global identity for cross-repo interop. |
| `skos:Concept` | `concepts` row | Identified by `(scheme, slug)` — see §3.1. |
| `skos:prefLabel` | `concepts.pref_label` | Exactly one per concept (we do not model per-language labels in v1 — see §10). |
| `skos:altLabel`, `skos:hiddenLabel` | `concept_labels` rows | Alternative/hidden labels power **lexical assignment** (§5.2) — the model-independent signal. |
| `skos:notation` | `concepts.slug` | A stable, scheme-unique machine key. |
| `skos:definition`, `skos:scopeNote` | `concepts.definition`, `concepts.scope_note` | Free text; also feeds the centroid assigner's embedding text (§5.3). |
| `skos:broader` / `skos:narrower` | `concept_relations` rows, **stored one direction only** (`broader`) | `narrower` is derived as the inverse, per SKOS convention. Hierarchy is a DAG (a concept may have multiple broader concepts); cycles are rejected on write. |
| `skos:related` | `concept_relations` rows (`related`) | Symmetric (stored once, queried both ways). Enforce SKOS's disjointness: `related` may not connect a concept to its own broader-transitive ancestor/descendant. |
| `skos:hasTopConcept` | derived | A scheme's top concepts = concepts with no `broader` relation in that scheme. Not stored. |
| `skos:exactMatch`, `skos:closeMatch` | `concept_relations` rows (`exact_match`, `close_match`) | **Cross-scheme mapping** — the interop mechanism between an imported external taxonomy and the local scheme, and between two repos' schemes. Deferred to phase C5 but in the schema from day one. |
| Deprecation (`owl:deprecated` idiom) | `concepts.status = 'deprecated'` + `concepts.replaced_by` | Concepts are never hard-deleted — see §7 (scheme evolution). |

**Explicitly skipped** (lightweight by design): RDF serialization as the
native format, `skos:Collection`/`OrderedCollection`, per-language label tags,
`broadMatch`/`narrowMatch`/`relatedMatch`, SKOS-XL. A best-effort Turtle
import/export can be added later without schema changes (§10); the native
interchange format is JSON (§6.1).

---

## 3. Conceptual model & options considered

### 3.1 Concept identity

The central design question, exactly parallel to the knowledge-graph's
node-key decision: concepts need **stable identity** that survives renames,
re-parenting, re-indexing, and travel between repos.

**Decision: `concept_key = "<scheme_slug>:<concept_slug>"`, with the slug
flat (not hierarchical).** e.g. `main:jwt-validation`, `owasp:a07`.

- The slug does **not** encode the broader-chain. A display path like
  `auth > token-refresh > jwt-validation` is *derived* at read time from
  `broader` relations. Re-parenting a concept (the most common curation edit)
  therefore never changes its identity, its assignments, or its history —
  this is what makes "scheme evolution without invalidating history" (§7)
  cheap.
- `pref_label` is freely editable; the slug is fixed at creation (changing it
  means deprecate + replace, §7).
- CLI/MCP accept friendly references — a bare slug, a label, or a `/`-joined
  path (`auth/jwt` walks labels down the hierarchy) — and resolve them to the
  key; ambiguity is an error listing candidates.

### 3.2 Where concepts live relative to existing structures — options

**Option A — concepts as `graph_nodes` + `edges`** (reuse the knowledge-graph
tables; `concept:` node kind, `broader` edge type, `about` edges to
file/symbol nodes).
*Rejected.* `graph_nodes`/`edges` are **truncate-and-rebuilt wholesale** by
`gitsema graph build` (schema.ts comment: "Rebuilt wholesale… like
`blob_clusters`"). Curated vocabulary must never be wiped by a derived-data
rebuild. Mixing durable curated rows into a recomputable table would force
every rebuild to carve around them — a standing bug factory. The graph also
carries structural semantics (`calls`, `imports`) that don't apply.

**Option B — a real RDF/triple store or embedded quad-store.**
*Rejected.* Massive dependency for a vocabulary that will typically hold tens
to low hundreds of concepts. The storage seam is relational; SKOS's subset
maps to 4 small tables losslessly for our needs.

**Option C — flat tags** (a `tags` table, no relations, no schemes).
*Rejected as an endpoint, but it is the v1 kernel.* Flat labels can't express
`auth > token-refresh`, synonyms, or cross-scheme mapping — which are exactly
the properties that make the layer model-independent *and useful*. The
incremental path (C1 ships vocabulary + manual tagging before any automation)
gives us the flat-tag utility on the way.

**Option D (chosen) — dedicated relational SKOS-subset tables** with a
**hard durability split**, mirroring the repo's established
immutable-vs-recomputable discipline:

| Layer | Tables | Lifecycle | Precedent |
|---|---|---|---|
| **Curated vocabulary** | `concept_schemes`, `concepts`, `concept_labels`, `concept_relations` | Durable. Edited by explicit commands; survives re-index, re-cluster, `graph build`, model changes. Never truncate-rebuilt. | `embed_config` + `settings` (durable config-like rows) |
| **Assignments** | `concept_assignments` | Split by method: `manual` rows are durable; automated rows (`lexical`, `centroid`, `llm`, `cluster`) are recomputable and replaced per-method by re-runs. | `graph_nodes`/`edges` (recomputable, confidence-carrying), `blob_clusters` (replaced per run) |

### 3.3 Relationship to clustering and the knowledge graph

- **Clusters are evidence, not concepts.** A cluster is an unstable,
  model-dependent grouping; a concept is a stable, model-independent name.
  The bridge (phase C4): map each cluster to concepts by lexical overlap
  between the cluster's `top_keywords`/label (already TF-IDF-enhanced via
  `enhanceClusters`) and concept labels, then (a) show concept names in
  `clusters` output — stable labels across re-clustering — and (b) optionally
  propagate the cluster's blob assignments to the matched concept at
  discounted confidence (§5.5).
- **The graph stays structural.** No concept rows in `graph_nodes`. Read-time
  enrichment (e.g. showing concepts of a node's underlying blob in
  `graph relate` output) is a later, purely presentational join. If a future
  phase wants concept edges materialized for traversal, that is an explicit
  derived projection *into* the graph rebuild, never the source of truth.

---

## 4. Schema

Two migrations, following the one-file-per-version pattern
(`src/core/db/migrations/NNN_name.ts`, appended to `runner.ts`, bump
`CURRENT_SCHEMA_VERSION`, mirror in `schema.ts` + `initTables`). Numbers below
assume v32 is still current when C1 lands; renumber if other work ships first
(note: the also-unscheduled `docs/semantic-enrichment-plan.md` pencils in v33
for its `enrichments` table — whichever design lands first takes v33).

### 4.1 Vocabulary tables — migration v32 → v33 (phase C1)

```ts
concept_schemes = sqliteTable('concept_schemes', {
  slug:        text('slug').primaryKey(),          // 'main', 'owasp'
  title:       text('title').notNull(),
  /** Global identity for cross-repo interop (skos:ConceptScheme URI). Optional; */
  /** defaults to a tag-URI derived from slug on export. */
  uri:         text('uri').unique(),
  /** 'manual' | 'imported' — provenance of the scheme itself. */
  source:      text('source').notNull().default('manual'),
  createdAt:   integer('created_at').notNull(),
  updatedAt:   integer('updated_at').notNull(),
})

concepts = sqliteTable('concepts', {
  /** '<scheme_slug>:<concept_slug>' — the stable key (§3.1). */
  conceptKey:  text('concept_key').primaryKey(),
  schemeSlug:  text('scheme_slug').notNull().references(() => conceptSchemes.slug),
  slug:        text('slug').notNull(),             // skos:notation; flat, scheme-unique
  prefLabel:   text('pref_label').notNull(),       // skos:prefLabel
  definition:  text('definition'),                 // skos:definition
  scopeNote:   text('scope_note'),                 // skos:scopeNote
  /** 'proposed' | 'approved' | 'deprecated' — curation state (§6). */
  status:      text('status').notNull().default('approved'),
  /** 'manual' | 'llm' | 'imported' — who created it (§6). */
  source:      text('source').notNull().default('manual'),
  /** Deprecation forwarding (§7): concept_key of the replacement, if any. */
  replacedBy:  text('replaced_by'),
  createdAt:   integer('created_at').notNull(),
  updatedAt:   integer('updated_at').notNull(),
}, (t) => ({ schemeSlugUnique: uniqueIndex(...).on(t.schemeSlug, t.slug) }))

concept_labels = sqliteTable('concept_labels', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  conceptKey:  text('concept_key').notNull().references(() => concepts.conceptKey),
  label:       text('label').notNull(),
  /** 'alt' | 'hidden' (prefLabel lives on the concept row). */
  kind:        text('kind').notNull().default('alt'),
}, (t) => ({ perConcept: uniqueIndex(...).on(t.conceptKey, t.label) }))

concept_relations = sqliteTable('concept_relations', {
  srcKey:      text('src_key').notNull().references(() => concepts.conceptKey),
  dstKey:      text('dst_key').notNull().references(() => concepts.conceptKey),
  /** 'broader' (src's broader is dst; narrower derived as inverse) |
      'related' (symmetric; stored once with srcKey < dstKey) |
      'exact_match' | 'close_match' (cross-scheme mapping, §2). */
  relation:    text('relation').notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.srcKey, t.dstKey, t.relation] }) }))
```

Write-time integrity (enforced in `ConceptStore`, not SQL triggers):
`broader` must stay acyclic; `related`/matches must not duplicate a
broader-transitive link; relations may not target `deprecated` concepts
(existing relations to a concept being deprecated are retargeted or dropped
per §7).

### 4.2 Assignments — migration v33 → v34 (phase C2)

```ts
concept_assignments = sqliteTable('concept_assignments', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  conceptKey:  text('concept_key').notNull().references(() => concepts.conceptKey),
  /** 'blob' | 'chunk' | 'symbol' | 'cluster' — what is being tagged. */
  targetKind:  text('target_kind').notNull(),
  /** Path-free, content-addressed identity (§5.1):
      blob:    <blob_hash>
      chunk:   <blob_hash>#<start>-<end>
      symbol:  <blob_hash>#<qualified_name>#<signature_hash>   (occurrence identity, Phase 105)
      cluster: <cluster_id>@<clustered_at>                     (run-scoped; C4 only) */
  targetKey:   text('target_key').notNull(),
  /** 'manual' | 'lexical' | 'centroid' | 'llm' | 'cluster' (§5). */
  method:      text('method').notNull(),
  confidence:  real('confidence').notNull(),        // 0..1 (§5.6)
  /** Embedding model that produced this assignment — REQUIRED for 'centroid'
      (it is model-dependent), null for model-independent methods. */
  model:       text('model'),
  createdAt:   integer('created_at').notNull(),
}, (t) => ({
  uniq: uniqueIndex(...).on(t.conceptKey, t.targetKind, t.targetKey, t.method),
  byTarget: index(...).on(t.targetKind, t.targetKey),
  byConcept: index(...).on(t.conceptKey, t.method),
}))
```

No FK from `target_key` to `blobs` — assignments may be imported ahead of
content (e.g. a shared scheme file tags blob hashes this clone hasn't indexed
yet), and `index gc` must not cascade into curated data. `concepts doctor`
(folded into `index doctor --extended`) reports dangling targets instead.

### 4.3 Storage seam — `ConceptStore`

A fifth store on `StorageProfile` (alongside `metadata` / `vectors` / `fts` /
`graph`), **relational-only**, exactly following the `GraphStore` precedent:

```ts
interface ConceptStore {
  // vocabulary (durable)
  upsertScheme(s: ConceptSchemeRecord): Promise<void>
  createConcept(c: ConceptRecord): Promise<void>
  updateConcept(key: string, patch: Partial<ConceptRecord>): Promise<void>
  getConcept(key: string): Promise<ConceptRecord | undefined>
  resolveConcept(ref: string): Promise<ConceptRecord[]>       // slug | label | path → candidates
  listConcepts(opts?: { scheme?: string; status?: ConceptStatus }): Promise<ConceptRecord[]>
  setLabels(key: string, labels: ConceptLabelRecord[]): Promise<void>
  relate(src: string, dst: string, relation: ConceptRelation): Promise<void>  // validates §4.1 integrity
  unrelate(src: string, dst: string, relation: ConceptRelation): Promise<void>
  /** Narrower-transitive closure of `key`, depth-capped (§8.1 faceted-search expansion). */
  narrowerClosure(key: string, maxDepth?: number): Promise<string[]>

  // assignments (manual durable; automated replaced per method)
  assign(a: ConceptAssignmentRecord): Promise<void>
  unassign(conceptKey: string, targetKind: TargetKind, targetKey: string, method?: AssignMethod): Promise<void>
  replaceMethodAssignments(method: AssignMethod, rows: ConceptAssignmentRecord[], opts?: { conceptKey?: string; model?: string }): Promise<void>
  assignmentsFor(targetKind: TargetKind, targetKeys: string[]): Promise<Map<string, ConceptAssignmentRecord[]>>
  targetsFor(conceptKeys: string[], opts?: { kinds?: TargetKind[]; minConfidence?: number }): Promise<ConceptAssignmentRecord[]>
  coverage(opts?: { scheme?: string }): Promise<ConceptCoverageStats>
}
```

- **sqlite** implements it in C1/C2.
- **postgres** implements it in C5 (plain relational DDL, no pgvector needed).
- **qdrant profile**: `UnsupportedConceptStore` throwing
  `"concept vocabulary requires a relational backend"` on every method —
  same fail-loud rule as `UnsupportedGraphStore` (review9 §4). Note the
  qdrant profile does have a Postgres metadata companion; once the Postgres
  `ConceptStore` exists (C5), the qdrant profile wires concepts through that
  companion and the unsupported stub disappears for it.
- `storage migrate` gains the five tables in its copy path (C5); `storage
  info`/`doctor` report concept availability per backend.

---

## 5. Assignment mechanics & confidence

### 5.1 Targets are content-addressed and path-free

All assignment targets use blob-intrinsic identities (§4.2 `target_key`),
mirroring the knowledge-graph occurrence discipline. Consequences:

- Assignments survive renames/moves for free (same blob hash).
- An edited file gets a new blob hash and **starts unassigned** — automated
  assigners re-cover it on the next run; manual assignments are re-attached
  via a helper (`concepts tag --carry-forward <path>` copies the previous
  blob-version's manual tags to HEAD's blob after review) rather than
  silently guessed.
- History queries come free: joining assignments × `blob_commits` yields
  "when did material under this concept first appear" with the exact
  mechanism `first-seen` already uses.
- **Blob-level (`targetKind='blob'`) is the primary kind in C2**; `chunk` and
  `symbol` are in the schema from day one but only populated once an assigner
  produces them (LLM/centroid at chunk granularity is a natural C3 extension).

### 5.2 Method: `lexical` (model-independent — the backbone)

Matches concept labels against index-side text signals. Entirely
string-based, therefore **valid across embedding models and repos** — this is
the method that realizes the feature's defining property, so it ships first
(C2) and is the default `concepts assign` mode.

Signals, reusing existing machinery:

1. **Path tokens** — `splitIdentifier` + `normalizeToken` from
   `labelEnhancer.ts` over each blob's paths.
2. **FTS content** — BM25 lookups (`FtsStore.search`) per concept label
   (pref + alt; `hidden` labels participate in matching but are never
   displayed, per SKOS).
3. **Cluster keywords** — `blob_clusters.top_keywords` for the blob's current
   cluster (when a clustering run exists).

Score = weighted combination (path hit > FTS hit > cluster-keyword hit),
normalized to 0..1; assignments below `concepts.assignThreshold` (default
0.35) are dropped. Multi-word labels must match as phrases in FTS and as
adjacent tokens in paths. Runs are **streaming** (batch over blobs, bounded
memory) and **replace prior `lexical` rows wholesale**
(`replaceMethodAssignments`), like a cluster run.

### 5.3 Method: `centroid` (model-dependent, explicitly marked)

Embeds each concept's text (`pref_label + altLabels + definition`) with the
**active text model** and assigns blobs whose embedding cosine similarity
exceeds the threshold (via the existing `VectorStore.search` path).
Confidence = calibrated similarity. **The assignment row records `model`** —
these rows are only meaningful within that model's space, and the query layer
ignores centroid rows whose model doesn't match the active profile. The
*concept itself* stays model-independent; only this evidence layer is scoped.
Ships in C3.

### 5.4 Method: `llm` (optional, safe-by-default)

Batch classification through the existing narrator plumbing
(`resolveNarrator.ts` configs in `embed_config` kind rows, active selection in
`settings`): "given this scheme's concepts (labels + definitions) and this
chunk, which concepts apply?" Follows every established narrator convention:

- **Safe-by-default**: no configured narrator model → the command reports
  "LLM assignment requires a configured narrator model" and exits cleanly
  (`createDisabledProvider` pattern). Never a hard failure.
- **Redaction is mandatory**: all outbound content passes `redact.ts`
  (`redact`/`redactAll`), same as `narrate`/`explain`.
- Confidence = LLM-reported, **capped at 0.9** (only `manual` reaches 1.0).
- Cost-bounded: `--max-targets <n>` and concept/paths filters; resumable by
  skipping (concept, target, method='llm') rows that already exist.

Ships in C3, after the model-independent backbone is proven.

### 5.5 Method: `cluster` (bridge, C4)

For each cluster in the latest run: lexically match its
`top_keywords` + label against concept labels; on a match above threshold,
(a) record the cluster→concept mapping
(`targetKind='cluster'`, `targetKey='<id>@<clustered_at>'`) so `clusters`
output can display stable concept names, and (b) optionally
(`--propagate`) assign the cluster's member blobs to the concept at
`0.6 × match-score` confidence. Cluster assignments are wiped with each
re-cluster (they reference run-scoped IDs); propagated blob rows are
replaced on each bridge run like other automated methods.

### 5.6 Confidence & aggregation model

- One row per `(concept, target, method)`; methods accumulate as independent
  evidence rather than overwriting each other.
- **Effective confidence** at query time = `max` over the target's valid rows
  (centroid rows filtered by active model, §5.3). Shown with its winning
  method in output (`0.82 via lexical`), so users can calibrate trust —
  the same transparency rule as graph edge confidence.
- Method priors: `manual` = 1.0 · `llm` ≤ 0.9 · `centroid` ≤ ~0.9 (calibrated
  cosine) · `lexical` ≤ 0.8 · `cluster` ≤ 0.6.
- Query-side floor: `concepts.minConfidence` (default 0.5) — an assignment
  below the floor exists as evidence but doesn't make a blob answer for the
  concept in filtered search.

---

## 6. Curation model

**Decision: hybrid — three sources with provenance, human approval gating
automated proposals.** Every concept row carries `source`
(`manual` | `llm` | `imported`) and `status`
(`proposed` | `approved` | `deprecated`).

1. **Manual (primary path, C1).** `gitsema concepts add/label/relate/…`
   create `approved` concepts directly. The vocabulary is small (tens of
   concepts) and high-leverage — hand-curation is the realistic default, and
   it works with zero LLM configuration.
2. **LLM-proposed (C3).** `gitsema concepts propose` feeds cluster keyword
   digests + top paths through the narrator (redacted, safe-by-default, as
   §5.4) and inserts results as `status='proposed'`. Proposed concepts are
   visible in `concepts list --proposed` but **excluded from search
   filtering and assignment runs** until a human runs
   `concepts approve <key>` (or `reject`, which deletes — proposals carry no
   history worth preserving). `concepts.autoApprove=true` opts out of the
   gate for throwaway/experimental use.
3. **Imported (C1 for JSON; Turtle later).** `gitsema concepts import
   <file>` loads a scheme file (§6.1) as `source='imported'`,
   `status='approved'` (an external taxonomy is presumed curated). Re-import
   **upserts by `(scheme, slug)`** and prints an added/updated/now-missing
   diff; missing concepts are flagged, not auto-deprecated.

### 6.1 Interchange format

Native format: a **JSON scheme file** with a documented 1:1 SKOS mapping
(kept lightweight; no RDF dependency):

```jsonc
{
  "scheme": { "slug": "main", "title": "gitsema main vocabulary",
              "uri": "https://example.com/schemes/main" },
  "concepts": [
    { "slug": "jwt-validation", "prefLabel": "JWT validation",
      "altLabels": ["jwt verify", "token validation"],
      "definition": "Verification of JSON Web Token signatures and claims.",
      "broader": ["token-refresh"],
      "related": ["session-management"] }
  ]
}
```

`concepts export [--scheme s] [--include-assignments]` writes it;
`--include-assignments` adds blob-hash-keyed assignment rows, which transfer
meaningfully to any repo sharing content (content-addressing, §5.1). The file
is deliberately git-friendly — teams can commit it (e.g.
`.gitsema/concepts.json` by convention) and treat the vocabulary as reviewed
code. This file, plus scheme URIs and `exact_match`/`close_match` mappings,
is the entire cross-repo interop story in v1: **no network protocol, no
federation** — a scheme travels as a file.

---

## 7. Scheme evolution over time

Rules, all following the "never invalidate history" requirement:

- **Rename** — `pref_label` and labels are freely mutable; the key never
  changes. No assignment impact.
- **Re-parent** — edit `broader` relations; identity unaffected (§3.1).
- **Deprecate / merge** — `concepts deprecate <key> [--replaced-by <key2>]`
  sets `status='deprecated'` + `replaced_by`. Merging A into B =
  deprecate A with `--replaced-by B`. Assignments to A are **left in place**
  (they are historical fact); the query layer follows `replaced_by` chains
  (cycle-safe, depth-capped), so `--concept B` transparently includes
  material assigned to A. Deprecated concepts are hidden from default
  listings, excluded from new assignment runs, and warn when used directly.
- **Split** — create the new narrower concepts, re-run assigners (their
  labels now attract the material), optionally re-tag manual rows, then
  deprecate the parent or keep it as the broader hub. No special machinery.
- **Slug change** — not supported in place; it's create-new + deprecate-old
  with `replaced_by`, preserving both histories.
- **Hard delete** — only `concepts reject` on `proposed` rows, and a
  `concepts gc --deprecated --before <date>` escape hatch that refuses to run
  while assignments reference the concept unless `--force`.

---

## 8. Query surface (CLI / MCP / HTTP parity)

Per `docs/parity.md` conventions (and CLAUDE.md's "parity over response-shape
stability" rule), each phase ships its surface across CLI + MCP + HTTP
together; guide tools + `interpretations.ts` + `pnpm gen:skill` follow in C4
(the `docsSync` test enforces the pairing once guide entries exist).

### 8.1 CLI — new `concepts` command group

Registered as `src/cli/register/concepts.ts` (`registerConcepts(program)`
called from `all.ts`; entries added to `COMMAND_GROUPS` under a new
"Concepts" help bucket).

| Command | Phase | Description |
|---|---|---|
| `concepts list [--scheme s] [--tree] [--proposed]` | C1 | List/browse concepts; `--tree` renders the broader hierarchy |
| `concepts show <ref>` | C1 | One concept: labels, relations, definition, (C2+) assignment counts |
| `concepts add <slug> --label <l> [--scheme s] [--broader ref] [--definition d]` | C1 | Create an approved concept |
| `concepts label <ref> --alt <l> \| --hidden <l> \| --remove <l>` | C1 | Manage alt/hidden labels |
| `concepts relate <ref> <ref2> --as broader\|related\|exact-match\|close-match` / `unrelate` | C1 | Manage relations (integrity-checked) |
| `concepts deprecate <ref> [--replaced-by ref2]` | C1 | Deprecation/merge (§7) |
| `concepts import <file>` / `concepts export [--out f] [--include-assignments]` | C1 | JSON scheme interchange (§6.1) |
| `concepts tag <ref> <path\|blob:hash> [--carry-forward]` / `untag` | C2 | Manual assignment (resolves a path at HEAD to its blob hash) |
| `concepts assign [--method lexical\|centroid\|llm\|cluster] [--concept ref] [--dry-run]` | C2 (lexical) / C3 (centroid, llm) / C4 (cluster) | Run an automated assigner; replaces that method's rows |
| `concepts of <path\|blob:hash>` | C2 | Reverse lookup: which concepts cover this file/blob |
| `concepts coverage [--scheme s]` | C2 | Vocabulary health: per-concept target counts, % of HEAD blobs covered, unassigned top clusters |
| `concepts propose [--scheme s]` / `approve <ref>` / `reject <ref>` | C3 | LLM proposal workflow (§6) |
| `concepts diff <ref1> <ref2>` | C4 | Concept-level diff between git refs (assignments × `blob_commits`) |
| `search … --concept <ref> [--no-concept-expand]` | C2 | Faceted search: restrict to targets of the concept **and its narrower-transitive closure** (expansion on by default, depth-capped like `MAX_GRAPH_TRAVERSAL_DEPTH`; effective-confidence ≥ `concepts.minConfidence`). Implemented as a blob-hash filter into the existing `vectorSearch` options — same mechanism as `--branch`. |

`first-seen` gains `--concept` alongside `search` in C2 (it shares the search
pipeline). Broader flag rollout across `evolution`/`dead-concepts`/etc. is
left to the parity sweep in C4.

### 8.2 MCP tools — `src/mcp/tools/concepts.ts`

`registerConceptsTools(server)` wired in `src/mcp/server.ts`:

| Tool | Phase | Mirrors |
|---|---|---|
| `concept_list` | C1 | `concepts list` (scheme/status filters, tree flag) |
| `concept_show` | C1 | `concepts show` |
| `concept_of` | C2 | `concepts of` |
| `concept_coverage` | C2 | `concepts coverage` |
| `concept_assign` | C2/C3 | `concepts assign` (method param) |
| `concept_diff` | C4 | `concepts diff` |
| `semantic_search` gains optional `concept` + `concept_expand` params | C2 | `search --concept` |

Vocabulary *writes* (add/relate/deprecate/import) stay CLI-only in v1 —
curation is a deliberate human act; agents get read + assignment-run access.
(Guide tools mirror the read set in C4, with `TOOL_INTERPRETATIONS` entries
and regenerated skill per the docsSync contract.)

### 8.3 HTTP routes — `src/server/routes/concepts.ts`

`conceptsRouter()` mounted at `/api/v1/concepts` behind the standard
`authMiddleware` + `repoSessionMiddleware` chain:

| Route | Phase |
|---|---|
| `GET /api/v1/concepts` · `GET /api/v1/concepts/:key` | C1 |
| `GET /api/v1/concepts/:key/targets` · `GET /api/v1/concepts/of/:blobHash` · `GET /api/v1/concepts/coverage` | C2 |
| `POST /api/v1/search` accepts `concept` + `conceptExpand` | C2 |
| `POST /api/v1/concepts/assign` (method-scoped re-run; write-guarded like other mutating routes) | C3 |
| `GET /api/v1/concepts/diff` | C4 |

OpenAPI (`routes/openapi.ts`) and `docs/parity.md` matrix rows updated in the
same phase as each route — the parity doc gains a **Concepts** section with
the standard CLI/REPL/LSP/Guide/MCP/HTTP columns (REPL and LSP: `—` by
design; LSP hover enrichment is a possible later nicety, §10).

### 8.4 Config keys

`configManager.ts` `ALL_KEYS` additions: `concepts.scheme` (default scheme
slug, default `main`), `concepts.assignThreshold` (0.35),
`concepts.minConfidence` (0.5), `concepts.expandNarrower` (true),
`concepts.autoApprove` (false). Env mirrors (`GITSEMA_CONCEPTS_*`) via
`ENV_KEY_MAP` for the first three.

---

## 9. Phased implementation plan

Sized like existing PLAN.md phases; each ends with tests, `features.md` +
README + parity.md updates, and a changeset (per CLAUDE.md). C1+C2 alone
deliver a coherent, useful feature (curated vocabulary + model-independent
tagging + faceted search); C3–C5 are each independently shippable.

| Phase | Title | Schema | Deliverable | Effort |
|---|---|---|---|---|
| **C1** | Vocabulary core | v33 | `concept_schemes`/`concepts`/`concept_labels`/`concept_relations`; `ConceptStore` seam (sqlite + fail-loud stub); CLI `concepts list/show/add/label/relate/unrelate/deprecate/import/export`; JSON interchange; integrity rules (§4.1); MCP `concept_list`/`concept_show`; HTTP GET routes. | S–M |
| **C2** | Assignments & faceted search | v34 | `concept_assignments`; manual `tag`/`untag`/`of`; **lexical assigner** (streaming, labelEnhancer reuse); confidence/aggregation model (§5.6); `--concept` on `search`/`first-seen` with narrower-expansion; `coverage`; MCP/HTTP parity for all of it. | M |
| **C3** | Semantic assigners & LLM curation | — | `centroid` assigner (model-recorded, model-filtered at query); `llm` assigner + `propose/approve/reject` workflow (narrator plumbing, `redact.ts`, safe-by-default, cost bounds); `POST /concepts/assign`. | M |
| **C4** | Bridges, diffs & agent surface | — | Cluster↔concept bridge (§5.5) + concept names in `clusters` output; `concepts diff <ref1> <ref2>`; guide tools + `interpretations.ts` entries + `pnpm gen:skill`; `--concept` parity sweep over remaining query-string commands; `index doctor --extended` concept checks. | M |
| **C5** | Backend & interop completion | — | Postgres `ConceptStore` (qdrant profile routes through its Postgres companion); `storage migrate`/`info`/`doctor` coverage; scheme URIs + `exact_match`/`close_match` workflows documented; `multi_repo_search` accepts `concept` (resolved per-repo by scheme-URI + slug across the per-repo DBs); shared-scheme-file conventions. | M |

Total: a medium–large track (~5 phases), consistent with the feature-ideas
estimate; no networking, no new daemon, no new binary dependencies.

---

## 10. Remaining open questions (deliberately deferred)

1. **Turtle/RDF import-export** — worth a best-effort `skos:Concept` subset
   reader for real external taxonomies (OWASP, org-internal SKOS files)?
   Needs a user with an actual RDF file in hand; JSON covers the designed
   workflows. No schema impact either way.
2. **Per-language labels** (`prefLabel@lang`) — skipped in v1; adding a
   `lang` column to `concept_labels` later is a trivial migration. Decide
   when a non-English-vocabulary user appears.
3. **Chunk/symbol-granular automated assignment** — the schema supports it
   (§4.2); whether C3's LLM assigner should classify at chunk granularity by
   default (better precision, higher cost) needs a cost measurement on a real
   repo first.
4. **Concept-aware LSP hover** — showing a file's concepts in the hover card
   is cheap once C2 exists, but LSP surface changes belong to an LSP-track
   decision, not this design.
5. **Materializing `about` edges into the structural graph** — only if a
   future traversal use-case demands it (§3.3); presentational joins first.
6. **Interplay with Chunk-Level Semantic Enrichment** (see below) — if that
   idea ships, its per-chunk keywords become one more lexical signal and its
   keyword field could hold concept keys; nothing here depends on it.

### Relationship to the "Chunk-Level Semantic Enrichment" idea

This design **stands alone**: the lexical backbone (§5.2) draws on paths, FTS
content, and cluster keywords — all of which exist today. If enrichment ships
later, its LLM-extracted per-chunk keywords slot in as an additional (and
better-targeted) lexical signal, and its open "keyword normalization" design
gap gets a ready answer: normalize enrichment keywords **into concept
references** where a match exists. The dependency direction is
enrichment → (optionally feeds) → concepts, never the reverse.

---

## 11. Decisions taken autonomously (pending user review)

This refinement ran non-interactively; every product/scope call the
refine-idea flow would normally ask about was resolved from codebase evidence
and recorded here. Each is revisable before C1 is scheduled.

1. **Curation model = hybrid with human approval gating LLM proposals**
   (§6). *Rationale:* mirrors the repo's safe-by-default LLM posture
   (`createDisabledProvider`, evidence-only `narrate`); manual curation must
   work with zero LLM config since gitsema's core never requires an LLM;
   `concepts.autoApprove` preserves the fully-automated option.
2. **Dedicated durable tables, not graph-node reuse and not an RDF store**
   (§3.2). *Rationale:* `graph_nodes`/`edges` and `blob_clusters` are
   truncate-and-rebuilt (verified in schema comments and
   `clustering.ts`'s DELETE-then-insert transaction) — curated data cannot
   live there; an RDF store violates the lightweight/SQLite constraint.
3. **Flat slugs; hierarchy only in relations; display paths derived** (§3.1).
   *Rationale:* re-parenting is the most common curation edit and must not
   change identity — directly serves the "scheme evolution without
   invalidating history" design gap.
4. **Content-addressed, path-free assignment targets** (§5.1). *Rationale:*
   CLAUDE.md's blob-first constraint; matches the knowledge-graph occurrence
   discipline; makes assignments portable across repos sharing content and
   correct across renames.
5. **Lexical assignment is the backbone and ships before any
   embedding/LLM-based assigner** (§5.2, phase order). *Rationale:* it is the
   only method that is model-independent, which is the feature's defining
   property; it reuses proven machinery (`labelEnhancer.ts`, `FtsStore`).
6. **Centroid assignments record their model and are filtered by active
   model at query time** (§5.3). *Rationale:* keeps the model-independence
   guarantee honest — model-dependent evidence is allowed but explicitly
   scoped, consistent with the locked-model-set direction (Phase 128).
7. **Confidence = per-method rows, `max` aggregation, method priors, query
   floor** (§5.6). *Rationale:* follows the graph-edge confidence precedent
   (surface confidence so users calibrate trust); preserving independent
   evidence rows keeps re-runs idempotent per method.
8. **`ConceptStore` is relational-only with a fail-loud stub; sqlite first,
   Postgres in C5** (§4.3). *Rationale:* exact `GraphStore`/
   `UnsupportedGraphStore` precedent (review9 §4 "fail loud, don't no-op").
9. **Query surface = new `concepts` group + `--concept` facet on
   `search`/`first-seen`, with MCP/HTTP shipped in the same phase as each
   CLI feature; vocabulary writes CLI-only in v1** (§8). *Rationale:* the
   Design Gap demanded parity from day one (parity.md §4 priority); gating
   writes matches the "curation is a human act" model and keeps the MCP
   surface read-mostly like other tool families.
10. **Scheme evolution via SKOS-idiomatic deprecation + `replaced_by`
    forwarding; assignments never rewritten** (§7). *Rationale:* the
    deprecations-registry culture of this repo applied to data: history is
    preserved, queries follow forwarding chains, deletion is an explicit
    escape hatch.
11. **Cross-repo interop = scheme files + scheme URIs + match relations; no
    network protocol** (§6.1, C5). *Rationale:* the federation design was
    withdrawn precisely for network speculation; multi-repo is
    one-DB-per-repo (verified: no `repo_id` on content tables), so a
    file-travelling scheme + per-repo resolution in `multi_repo_search` is
    the smallest true interop story.
12. **JSON as the native interchange format; RDF/Turtle deferred** (§6.1,
    open question 1). *Rationale:* lightweight-implementation constraint from
    the idea entry; JSON preserves the SKOS semantics losslessly for the
    adopted subset.
13. **Doc filed as `docs/design/concept-vocabulary.md`.** *Rationale:* the
    skill's convention for a self-contained feature, and it sits beside the
    withdrawn `docs/design/semantic-federation.md` it was salvaged from.
