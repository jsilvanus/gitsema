# Semantic Federation: Distributing Knowledge Across Repositories

**Status:** ⛔ **WITHDRAWN (2026-07-09)** — removed from `docs/PLAN.md` before any implementation began. Retained for reference only; do not implement from this document.  
**Last updated:** 2026-07-09  
**Initiated by:** ChatGPT feedback on gitsema architecture

> **Why withdrawn:** The design centered on a speculative P2P/gossip network
> rather than the problem that actually motivated it (agent-scale read load
> concentrating on hosted repo endpoints), and it was written without
> reconciling against gitsema's shipped multi-tenant auth (Phases 122–126),
> storage abstraction (101–103), and locked-model-set (128) layers. It also
> collided with existing features (`semantic-blame`, `concept-lifecycle`,
> `index export/import`). The salvageable kernels — chunk-level semantic
> enrichment, a SKOS-style concept vocabulary, and prebuilt-index
> distribution for agent-scale serving — are tracked as fresh ideas in
> [`docs/feature-ideas.md`](../feature-ideas.md).

---

## Executive Summary

`gitsema` is a content-addressed semantic index synchronized with Git's object model. It solves the "indexing" problem: one repository gets full semantic coverage via embeddings, temporal analysis, and graph extraction.

**Semantic Federation** extends this to the network layer. Today, repositories are isolated semantic islands—each maintains its own index, each re-embeds content independently. Federation distributes semantic knowledge itself: repositories answer queries directly, share only relevant semantic objects with peers, and route queries intelligently to the most promising sources.

The core insight: **Git distributes bytes. Gitsema distributes meaning. Federation distributes knowledge.**

---

## Motivation

### Current State

1. **Per-repo indexes:** Every repository builds its own independent embeddings
2. **No cross-repo semantic queries:** To search "JWT implementation" across N repositories, you either:
   - Clone and index each locally (expensive)
   - Query each via separate API calls (slow, no ranking)
   - Use a centralized index (single point of failure, stale data)
3. **Embedded knowledge stays local:** A repository's semantic insights (author expertise, evolution patterns, debt scores) don't flow to peers
4. **Semantic deduplication lost at scale:** Identical concepts across repos get embedded N times
5. **No semantic routing:** Queries broadcast blindly instead of routing to relevant peers

### Why This Matters

- **AI coding assistants** need to search across team repositories for context
- **Monorepos** benefit from semantic DHT routing (query A → auth-team, query B → ui-team)
- **Security scanning** gets faster when vulnerabilities route to potentially-affected repos
- **Knowledge discovery** works better when repositories gossip their semantic centroids
- **Compliance/audit** gains from distributed provenance (signatures on semantic objects)

---

## Architecture: Three Layers

### Layer 1: Semantic Objects (✅ ~80% complete, needs enrichment)

**Current state:** Blobs are stored with embeddings; large blobs are chunked with per-chunk embeddings.  
**What we add:** Rich semantic metadata envelopes at chunk level.

```
semantic_object (content-addressed, not blob-addressed)
├── chunk_hash (content-addressed, stable across repos)
├── blob_hash (parent file reference)
├── embedding (Float32 vector)
├── summary (LLM-generated snippet)
├── keywords (extracted terms)
├── language (source code, prose, config, etc.)
├── entities (author, date, module path)
├── structural_refs (imports/calls/extends, if chunk-level)
├── references (backward pointers: which chunks cite this?)
├── line_range (if chunked: lines 42–87 in blob)
├── timestamp (when first indexed)
├── profile_version (embedding model + version, e.g. "text-embedding-3-small:1.0")
├── model_dimensions (vector dimensionality, e.g. 1536)
├── signer (public key, optional)
└── content_hash (hash of chunk content for cache-busting)
```

**Key design decision: Chunk-level granularity**
- Semantic objects wrap **chunks**, not whole blobs
- Enables fine-grained deduplication (identical code snippets across repos = one object)
- Summaries are specific ("JWT validation handler" not broad "auth module")
- Matches current gitsema chunking strategy (whole-file, function, fixed windows)

**Database changes:** New `semantic_objects` table + extend `chunk_embeddings` table with `summary`, `keywords`, `language`, `entities` columns.

```sql
CREATE TABLE semantic_objects (
  object_hash TEXT PRIMARY KEY,        -- content-addressed
  chunk_hash TEXT NOT NULL,            -- reference to chunk
  blob_hash TEXT,                      -- reference to parent blob
  embedding BLOB,                      -- Float32 vector
  summary TEXT,                        -- LLM summary
  keywords TEXT,                       -- JSON array: ["jwt", "token", ...]
  language TEXT,                       -- "code" | "prose" | "config"
  entities TEXT,                       -- JSON: {authors: [...], dates: [...]}
  structural_refs TEXT,                -- JSON: {imports: [...], defines: [...]}
  profile_version TEXT,                -- "text-embedding-3-small:1.0"
  model_dimensions INTEGER,            -- e.g. 1536
  signer TEXT,                         -- optional Ed25519 public key
  created_at DATETIME,
  updated_at DATETIME
);
```

**Benefits:**
- Richer semantic queries without re-fetching blobs
- Gossip protocol can propagate summaries without full embeddings
- Semantic diffs become composable (diff summaries instead of vectors)
- Cross-repo deduplication at chunk level (identical implementations = one object)
- Model version tracking enables cross-model federation decisions (Phase 159)

---

### Layer 2: Semantic Refs (new in Phase 154)

**Concept:** Git refs for semantic state. A snapshot of the semantic index at a point in time.

```
refs/sema/main
  └─ tree: sema_commit_hash
      ├── blob_uuid1 → semantic_object_hash
      ├── blob_uuid2 → semantic_object_hash
      └── ...
```

**Comparable to:**
- `refs/heads/main` points to a commit (Git's state)
- `refs/sema/main` points to a semantic index snapshot (Gitsema's state)

**Why:**
- Enables **incremental transfer:** `git sema fetch` only pulls semantic objects not in local index
- Enables **semantic history tracking:** Can diff semantic refs to see when understanding of a concept changed
- Enables **content-addressed dedup:** Two repos with identical semantic objects don't re-embed
- Enables **pack negotiation:** Like Git's pack protocol, but for semantic objects

**Data structure:**
```
sema_refs
├── name TEXT (e.g. "sema/main", "sema/release-v1")
├── target_sema_tree_hash TEXT (content hash of the semantic tree)
├── blob_count INT (for size hints)
├── created_at DATETIME
└── updated_at DATETIME

sema_trees
├── tree_hash TEXT (primary key)
├── parent_tree_hash TEXT (previous snapshot)
├── entries JSONL (list of {blob_id, semantic_object_hash})
└── metadata JSON (embedding model, repository URL, branch)
```

**Operations:**
- `gitsema sema push [--remote url]` — create/update semantic ref, push new semantic objects
- `gitsema sema pull [--remote url]` — fetch semantic ref + missing semantic objects
- `gitsema sema log [--ref] [--graph]` — show semantic ref history
- `gitsema sema diff <ref1> <ref2>` — semantic diff between two refs (high-level changes, not vectors)

**Benefits:**
- Repos can sync semantic knowledge like Git syncs commits
- Enables **semantic branches** (experiment with different embedding models, merge later)
- Enables **semantic package exchange** (next layer)

---

### Layer 3: Federation & Routing (new in Phases 155–158)

**Concept:** Multiple gitsema instances form a federated network. Repositories discover, query, and route semantic questions to peers.

#### Phase A: Peer Discovery & Registration (Phase 155)

**Problem:** How does Repo A learn about Repo B's semantic capabilities?

**Solution:** A lightweight gossip / registry layer.

```
gitsema tools serve --federation-mode
  ├── Exposes: GET /api/v1/federation/info
  │   └─ Returns: {
  │        repo_id: "uuid",
  │        url: "https://...",
  │        semantic_topics: [  # centroids per cluster
  │          { cluster_id: 1, centroid: [...], label: "auth", blob_count: 42 },
  │          { cluster_id: 2, centroid: [...], label: "ui", blob_count: 117 }
  │        ],
  │        embedding_model: "nomic-embed-text",
  │        last_updated: "2026-07-08T12:00:00Z"
  │      }
  └── And: POST /api/v1/federation/gossip
      └─ Receives peer federation info, propagates to known peers
```

**Lightweight registry (optional, can be P2P):**
```
A local or hosted registry:
- Repos register their federation URLs
- Clients query it to discover peers
- Entries expire if not refreshed (prevents stale data)
```

**Alternative:** Pure P2P gossip (no central registry). Each peer seeds with a list of bootstrap peers, then propagates via gossip protocol.

#### Phase B: Semantic Query Routing (Phase 156)

**Problem:** How do I query 100 repositories efficiently?

**Solution:** Route queries based on centroid similarity.

**Client-side (smart routing):**
```
query: "JWT implementation"
  1. Embed query with local model
  2. Compare to known peers' centroids:
     Repo A (auth cluster): 0.92 similarity
     Repo B (ui cluster): 0.31 similarity
     Repo C (crypto): 0.67 similarity
  3. Send query only to {A, C} (above threshold)
  4. Merge and rank results
```

**Benefits:**
- Reduces query broadcast storm
- Prioritizes high-signal peers
- Enables geographic routing (query → nearest peer)
- Enables role-based routing (security audit → infra repos)

**Implementation:**
- `semanticDHT.ts`: Build routing table from gossip info
- `routeQuery()`: Select top-N peers by centroid similarity
- `src/server/routes/federation/query.ts`: Distributed search endpoint

#### Phase C: Semantic Packfiles (Phase 157)

**Problem:** Fetching query results re-downloads all relevant blobs and embeddings.

**Solution:** Semantic packfiles—compressed bundles of related semantic objects.

```
git sema fetch --query "caching"
  1. Remote computes set of blobs matching query
  2. Packs matching semantic objects + minimal metadata
  3. Sends one efficient bundle (like git packfile)
  4. Client unpacks and stores locally
  5. Can fetch actual blob content on demand
```

**Packfile format:**
```
[varint: count]
[for each semantic object]
  [varint: blob_hash_len] [blob_hash]
  [varint: embedding_len] [embedding (Float32)]
  [varint: summary_len] [summary string]
  [varint: metadata_json_len] [metadata]
[SHA-256 checksum]
[signature (optional)]
```

**Operations:**
- `gitsema sema fetch --query "topic" [--remote url]` — fetch packfile for topic
- `gitsema sema pack --query "topic" [--output file]` — create packfile locally
- `gitsema sema unpack [--input file]` — import packfile into local index

**Benefits:**
- **Bandwidth efficiency:** Single blob transfer vs. N blob + N embeddings
- **Latency:** One round-trip per query instead of multi-pass negotiation
- **Deduplication:** Shared topics compress well across repos
- **Offline use:** Packfiles can be shared via email, S3, etc.

#### Phase C.5: Federation Search Storage Strategy

**Problem:** When you query federated peers via `gitsema federation search`, what happens to the results?

Option 1: **Transient** — results displayed, not stored
Option 2: **Cached** — results stored in a session-scoped table, available for re-query
Option 3: **Imported** — results merged into your permanent local semantic_objects table

**Design:** Support all three via flags, with caching as default.

```bash
# Option 1: Transient (no storage)
gitsema federation search "JWT" --no-cache
  → queries peers, shows results, discards

# Option 2: Cached (session scope) [DEFAULT]
gitsema federation search "JWT" --cache
  → queries peers, stores in temp semantic_objects (in-memory or temp DB)
  → re-running same query hits cache (no peer call)
  → cache expires on session close

# Option 3: Imported (permanent)
gitsema federation search "JWT" --import
  → queries peers
  → pulls semantic objects into YOUR permanent index
  → future `gitsema search "JWT"` hits local index (no peer call)
  → now `gitsema first-seen` can trace to imported chunks
```

**Storage tables:**
```sql
-- Permanent semantic objects (yours)
semantic_objects (scope: local)

-- Session cache (federation results)
federation_cache (scope: temp, TTL: session)

-- Imported federation results (merged into semantic_objects)
-- (same table, marked with origin metadata)
```

**Metadata tracking:**
- Permanent objects: `origin: "local"`
- Cached objects: `origin: "federation_temp"`, `peer_url: "https://..."`
- Imported objects: `origin: "federation_imported"`, `peer_url: "https://..."`, `import_date`

**Benefit:** Users can control federation integration:
- **Pure federation** (--no-cache): use federation as a search engine, keep local index clean
- **Hybrid federation** (--cache, default): federation as a cache layer, no permanent changes
- **Integrated federation** (--import): absorb peer insights into your index for future local searches

---

#### Phase D: Semantic Commits & Deltas (Phase 158)

**Problem:** When a repository changes, how do peers know what concepts changed?

**Solution:** Automatic semantic commits on every Git commit.

**Concept:** Every Git commit automatically generates a semantic delta.

```
Git commit:
  commit 7b2f...
    Author: alice
    Message: "Add JWT token refresh"
    Files: auth.ts, session.ts

Automatic semantic commit:
  semantic_commit 7b2f-sema...
    Base: previous_semantic_commit
    Added concepts:
      - "JWT token refresh" (embedding)
      - "expiration handler" (new symbol)
      - Auth flow diagram (if prose)
    Removed concepts:
      - "hardcoded token expiration" (old symbol)
    Changed concepts:
      - "session management" (large semantic delta)
    Provenance: {
      git_commit: 7b2f...,
      blob_changes: [auth.ts sha1, session.ts sha1],
      author: alice,
      timestamp: ...
    }
```

**Queries powered by semantic commits:**
- "Show me repos that recently improved OAuth" → search semantic commit messages
- "Who improved caching in the last week?" → semantic blame on semantic commits
- "What's breaking authentication?" → trace causality via semantic deltas

**Implementation:**
- New `semantic_commits` table (parent, summary, added/removed/changed concepts)
- On each `index start`, compute deltas from previous semantic state
- `gitsema semantic-commits [--ref]` — show semantic commit log
- `gitsema semantic-blame <query> [--file]` — blame by semantic change, not line change
- Gossip semantic commits between peers (lightweight—just metadata)

**Benefits:**
- Concept-level causality (not just file-level)
- Efficient gossip (one semantic commit per Git commit)
- Enables root-cause analysis ("which commit introduced this pattern?")
- Works across repositories (shared semantic understanding)

---

## Integration Points

### MCP

Extend `GUIDE_TOOLS` with federation operations:
```typescript
// Phase 155
federation_info()          // Get peer federation metadata
federation_peers()         // List known peers

// Phase 156
federation_search()        // Query across federated peers
route_query()              // Get query routing decision

// Phase 157
sema_pack()                // Create semantic packfile
sema_fetch()               // Fetch packfile from peer

// Phase 158
semantic_commits()         // Search semantic commits
semantic_blame()           // Blame by semantic change
```

### HTTP API

```
// Phase 155
GET /api/v1/federation/info
POST /api/v1/federation/peers

// Phase 156
POST /api/v1/federation/search
GET /api/v1/federation/route?query=...

// Phase 157
POST /api/v1/federation/pack
GET /api/v1/federation/fetch?packfile_id=...

// Phase 158
GET /api/v1/semantic-commits
POST /api/v1/semantic-blame
```

### CLI

```bash
# Phase 154 (Semantic Refs)
gitsema sema push [--remote url]
gitsema sema pull [--remote url]
gitsema sema log [--graph]
gitsema sema diff <ref1> <ref2>

# Phase 155 (Discovery)
gitsema federation info
gitsema federation peers

# Phase 156 (Routing)
gitsema federation search <query> [--peers url,url]
gitsema federation route <query>

# Phase 157 (Packfiles)
gitsema sema pack --query "topic" [--output file]
gitsema sema fetch --query "topic" [--remote url]
gitsema sema unpack [--input file]

# Phase 158 (Semantic Commits)
gitsema semantic-commits [--ref]
gitsema semantic-blame <query> [--file path]
```

---

## Design Constraints & Trade-offs

### Immutability & Provenance

**Constraint:** Semantic objects are immutable once created (like Git objects).

- Enables **content-addressed deduplication** (same concept in two repos = same object ID)
- Enables **offline verification** (cryptographic signatures don't require live coordinator)
- Enables **long-term archival** (semantic objects don't rot)

**Trade-off:** Can't update a semantic object if we find it was wrong. Instead, create a new semantic object with corrections + metadata linking to the original (like Git commits linking to parents).

### Centralized vs. Peer-to-Peer

**Recommendation:** P2P gossip with optional bootstrap registry.

- **Centralized registry:** Simpler discovery, but single point of failure
- **P2P gossip:** Resilient, but requires bootstrap mechanism

**Hybrid approach:** Support both. Repos can register with an optional registry and/or seed with known peers.

### Semantic Versioning & Cross-Model Federation

**Constraint:** Semantic objects are bound to their embedding model version.

If Repo A indexes with `nomic-embed-text` v1.5 and Repo B uses `text-embedding-3-small` v1.0, their vectors live in different vector spaces and are not directly comparable (different dimensions, different semantic structure).

**Problem:** In a federated network, repos will use different models (different hardware, different requirements, model updates over time). How do we federate across model boundaries?

**Solutions (by phase):**

| Phase | Approach | Cost | Accuracy | Notes |
|---|---|---|---|---|
| **154–156** | Require model match | Low | High | Repo A only queries Repo B if same `profile_version` |
| **157** | Cache same-model results | Medium | High | Packfiles tagged by model; only import if model matches |
| **159** *(future)* | Re-embed on query | High | High | Query embedded with each peer's model, results merged |
| **162** *(future)* | Cross-space similarity | Research | Unknown | Use alignment layers / model mapping (open research) |

**Recommendation for Phases 154–158:** 
- Store `profile_version` + `model_dimensions` in every semantic object
- Phase 154–156: Reject cross-model federation (log warning: "Repo B uses text-embedding-3-small, you use nomic-embed-text; skipping")
- Phase 157: Same-model packfiles only
- Phase 159 design doc: Plan re-embedding strategy for Phase 160+

**Implementation detail:** Add `GITSEMA_FEDERATION_ALLOW_CROSS_MODEL` env var (default false) for experimental cross-model federation; if enabled, log a warning and attempt best-effort matching (documented as unreliable).

### Trust & Signatures

**Recommendation:** Optional public-key signing for federated semantic objects.

- Repos can sign semantic commits with their private key
- Peers verify signatures before incorporating remote semantic objects
- Enables **audit trails** (who claimed this semantic knowledge?)
- Enables **attribution** (give credit when one repo's embeddings improve another's)

**Not required for Phase 154–157,** but design with extensibility in mind. Add as optional field in `sema_trees` + `semantic_objects` tables.

---

## Phasing & Dependencies

### Phase 154: Semantic Refs & Incremental Transfer

**Goal:** Enable semantic index snapshots and incremental sync between repositories.

**Dependencies:** None (builds on existing Layer 1 enrichment).

**Deliverables:**
- `sema_refs` + `sema_trees` tables
- `gitsema sema push/pull/log/diff` CLI commands
- HTTP endpoints: `POST /api/v1/sema/push`, `GET /api/v1/sema/pull`
- MCP tools: `sema_push()`, `sema_pull()`, `sema_log()`
- Tests + docs

**Effort:** ~2 weeks  
**Risk:** Low (additive; doesn't change existing index format)

---

### Phase 155: Federation Discovery & Gossip

**Goal:** Enable repositories to discover and register with peers.

**Dependencies:** Phase 154 (semantic refs).

**Deliverables:**
- `federation_info()` HTTP endpoint + gossip protocol
- Lightweight peer registry (optional)
- `gitsema federation peers` + `gitsema federation info` CLI
- MCP tools: `federation_peers()`, `federation_info()`
- Tests + docs

**Effort:** ~1.5 weeks  
**Risk:** Low (read-only discovery; no data mutation)

---

### Phase 156: Semantic Query Routing

**Goal:** Route queries intelligently to the most relevant peers based on centroid similarity.

**Dependencies:** Phases 154, 155.

**Deliverables:**
- Semantic DHT routing table (`semanticDHT.ts`)
- `gitsema federation search` command
- HTTP endpoint: `POST /api/v1/federation/search`
- MCP tool: `federation_search()`
- Query result merging & ranking
- Tests + docs

**Effort:** ~3 weeks  
**Risk:** Medium (involves distributed ranking; needs careful testing across multiple repos)

---

### Phase 157: Semantic Packfiles

**Goal:** Enable efficient bulk transfer of semantic objects related to a query.

**Dependencies:** Phases 154–156.

**Deliverables:**
- Packfile format + serialization (`semanticPackfile.ts`)
- `gitsema sema pack/fetch/unpack` CLI commands
- HTTP endpoints: `POST /api/v1/federation/pack`, `GET /api/v1/federation/fetch`
- MCP tools: `sema_pack()`, `sema_fetch()`
- Decompression + integration with local index
- Tests + docs

**Effort:** ~2.5 weeks  
**Risk:** Medium (new binary format; needs robust error handling)

---

### Phase 158: Semantic Commits & Deltas

**Goal:** Track semantic changes per Git commit and enable concept-level causality analysis.

**Dependencies:** Phases 154–157 (optional; can ship independently).

**Deliverables:**
- `semantic_commits` table
- Delta computation on `index start` (compare to previous semantic state)
- `gitsema semantic-commits` + `gitsema semantic-blame` CLI commands
- HTTP endpoints: `GET /api/v1/semantic-commits`, `POST /api/v1/semantic-blame`
- MCP tools: `semantic_commits()`, `semantic_blame()`
- Tests + docs

**Effort:** ~2 weeks  
**Risk:** Medium (delta computation is complex; needs extensive testing on real repos)

---

## Success Metrics

### Phase 154
- [ ] Semantic refs created and persisted correctly
- [ ] `gitsema sema push/pull` transfer only new objects (verify via packet capture)
- [ ] `gitsema sema diff` correctly shows conceptual changes between refs

### Phase 155
- [ ] Peer discovery works in a 3-repo test setup
- [ ] Gossip protocol propagates info within 5 rounds
- [ ] Peer registry (if used) stays consistent

### Phase 156
- [ ] Query routing selects relevant peers (validate against ground truth)
- [ ] Merged results from multiple peers are ranked correctly
- [ ] Latency improvement over naive broadcast (measure vs. Phase 155 baseline)

### Phase 157
- [ ] Packfiles reduce bandwidth by 50%+ over individual fetches
- [ ] Decompression is fast enough for interactive use (<500ms for typical query)
- [ ] Packfiles can be shared offline and imported correctly

### Phase 158
- [ ] Semantic commits are created on every indexing run
- [ ] Deltas correctly identify added/removed/changed concepts
- [ ] Semantic blame traces causality correctly across multiple commits

---

## Risks & Mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| Semantic object size explosion | Medium | Quantization + gzip; lazy-load full vectors |
| Gossip storm / network saturation | High | Bounded peer lists; rate limiting on gossip |
| Model drift (embedding versions diverge) | Medium | Version pinning in semantic refs + re-embedding fallback |
| Byzantine peers (malicious semantic data) | Medium | Optional signing + verification; federation allow-lists |
| Stale peer info | Low | TTL on gossip + periodic refresh |
| Distributed query latency | Medium | Parallel fetches + early-exit thresholds |

---

## Open Questions

1. **Incentives:** Why would a repository publish semantic indexes publicly? (Privacy? Cost? Liability?)
2. **Standards:** Should this layer on a standard like SCITT or OpenVEX for supply-chain provenance?
3. **Scale:** How many peers can a single repository reasonably connect to? (Experiments needed.)
4. **Hybrid:** Could this integrate with a blockchain or IPFS for immutable semantic history?
5. **AI integration:** How does this layer interact with AI models? Can semantic commits improve grounding?

---

## Relationship to Existing Work

- **Git packfiles:** Semantic packfiles are the analog for meaning-transfer
- **BitTorrent / IPFS:** Inspiration for P2P discovery and content distribution
- **Supply-chain security (SLSA, SCITT):** Could layer on top for auditing semantic changes
- **Semantic versioning (semver):** Complements; semantic versioning applies to APIs, semantic federation applies to domain knowledge
- **Knowledge graphs / linked data:** Similar goals (distributed knowledge), different mechanisms (federation is pull-based; RDF is publish-all)

---

## Files to Create / Modify

**New files:**
- `docs/design/semantic-federation.md` (this document)
- `src/core/federation/semanticRefs.ts` (Phase 154)
- `src/core/federation/semanticDHT.ts` (Phase 156)
- `src/core/federation/semanticPackfile.ts` (Phase 157)
- `src/core/federation/semanticCommits.ts` (Phase 158)
- `src/server/routes/federation/` (HTTP endpoints)
- `src/mcp/tools/federation.ts` (MCP tools)
- Tests: `tests/federation/`

**Existing files to update:**
- `docs/PLAN.md` (add phases 154–158)
- `docs/features.md` (add federation section)
- `src/core/db/schema.ts` (extend with federation tables)
- `src/core/db/sqlite.ts` (migration for federation schema)
- `src/mcp/tools/` (register new federation tools)

---

## Next Steps

1. **Feedback round:** Get team consensus on the three-layer model and phasing
2. **Database schema:** Design `sema_refs`, `sema_trees`, `semantic_commits` tables + migrations
3. **Prototype:** Phase 154 proof-of-concept (semantic refs sync between two repos)
4. **Write phases:** Draft detailed PLAN.md entries for phases 154–158
5. **Begin Phase 154:** Start implementation once schema approved
