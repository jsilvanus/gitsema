# Prebuilt Index Distribution — "index once, serve many"

**Status:** Draft (refined 2026-07-09 from the `docs/feature-ideas.md` entry of the
same name; not yet scheduled in `docs/PLAN.md`)
**Scope:** Publishable, content-addressed index artifacts keyed by
(repo, commit, embed config); delta bundles for incremental catch-up;
`index publish` / `index attach` CLI; boring-HTTPS resolution (gitsema server,
GitHub Releases, plain URL); server-side bundle serving under the existing
auth/grant model. **No P2P, no gossip, no DHT, no new network protocol, no new
daemon.**
**Origin:** Salvaged kernel of the withdrawn semantic-federation design
(`docs/design/semantic-federation.md`, ⛔ withdrawn 2026-07-09). This doc keeps
that design's one sound observation — a gitsema index is a deterministic,
shareable artifact — and discards its distribution mechanism entirely in favor
of static-artifact conventions over HTTPS.

---

## 1. Motivation

Swarms of coding agents are becoming the dominant read load on code-hosting
infrastructure. For gitsema specifically, every agent/machine/CI job that wants
semantic access to a repo today has exactly two options:

1. **Re-embed the entire history locally** (`gitsema index start`) — expensive,
   slow, and N× duplicated embedding spend for byte-identical content. For a
   mid-size repo this is minutes-to-hours of GPU/API cost that some other
   consumer already paid.
2. **Query one shared `gitsema tools serve` instance** — load concentrates on a
   single query endpoint, which is precisely the "agents hammering one hosting
   endpoint" problem that motivated the federation idea in the first place.

gitsema's content-addressed model makes a third option obviously available: an
index for (repo, commit, embed config) is **deterministic** — two consumers
computing it independently produce semantically identical artifacts. There is
no reason for it to ever be computed twice. The design constraint "immutable
embeddings — a blob is embedded exactly once" (CLAUDE.md) currently stops at
the machine boundary; this design extends it across machines: *a blob is
embedded exactly once, anywhere.*

Reads then scale the way static files scale — by copying artifacts through
caches and CDNs — not by adding query capacity. A consumer downloads the
prebuilt index once, then runs every subsequent query locally at zero marginal
cost to the publisher.

Nearly all the pieces already exist:

- `index export` / `index import` tar.gz bundles (Phase 54,
  `src/cli/commands/bundleIndex.ts`)
- public repo sharing with attach-as-reader grants (Phases 126–127,
  `docs/public-repo-sharing-plan.md`)
- embed-config provenance (`embed_config` table + `computeConfigHash()`,
  `src/core/indexing/provenance.ts`) and profile pinning
  (`repos.profile_name`, Phase 128, `docs/locked-model-set-plan.md`)
- multi-tenant auth: users/api_keys/repo_grants/audit_log (Phases 122–126)
- the server-side repo registry (`GITSEMA_DATA_DIR`,
  `repos/<repoId>/{repo,index.db}`, `src/core/indexing/repoRegistry.ts`)

What is missing is **distribution**: a publish/resolve/fetch convention that
ties them together.

---

## 2. Current state (verified against source)

### 2.1 The Phase 54 bundle (`src/cli/commands/bundleIndex.ts`)

- `gitsema index export --out <file>` tars `.gitsema/index.db` plus any
  `*.usearch` / `*.map.json` VSS files, adds a `manifest.json` with
  `{schemaVersion, checksums (sha256 per file), exportedAfter, exportedAt}`,
  and gzips the result.
- `gitsema index import --in <file>` extracts, validates per-file checksums,
  **overwrites** `.gitsema/index.db` wholesale (`writeFileSync`), then opens
  the DB to run migrations.
- **The `--after`/`--since` "incremental slice" is provenance-only.** Despite
  the file-header comment ("filters blobs by first_seen timestamp"), the
  export path archives the *entire* `index.db` unconditionally; `afterTs` is
  merely recorded in the manifest and echoed on import. There is no actual
  filtering and no merge-on-import — a Phase 54 "incremental" bundle is a full
  bundle with a label. This is both a documentation bug today and the gap the
  delta mechanism in this design fills.
- The manifest carries **no embed-config provenance, no repo identity, and no
  commit tip** — an importer cannot tell which repo, which commit range, or
  which embedding model a bundle is for without opening the DB.

### 2.2 Embed-config provenance (Phase 80+/128)

- `embed_config` rows record `{provider, model, codeModel, dimensions,
  chunker, windowSize, overlap}`; `computeConfigHash()` is a SHA-256 over
  exactly those seven keys, sorted (`provenance.ts:30-42`). One index DB may
  legitimately contain several configs (multi-model DBs are supported;
  `checkConfigCompatibility()` only rejects same-model/different-dimensions).
- **Quantization is *not* part of `configHash`.** It is recorded per embedding
  row (`quantized`, `quant_min`, `quant_scale` columns on `embeddings`,
  `chunk_embeddings`, `symbol_embeddings`, `module_embeddings`). Search
  dequantizes at read time, so mixed-quantization reads work; it matters only
  when a consumer wants to *continue indexing* into an imported DB.
- Server-side, `repos.profile_name` (v32) pins each repo to one named
  embedding profile at first index; profiles are operator-defined
  (`GITSEMA_EMBEDDING_PROFILES`, `src/core/embedding/profiles.ts`).

### 2.3 Identity, auth, sharing

- Server-side repo identity: `normalizeRepoUrl()` +
  `sha256(normalizedUrl).slice(0,16)` → `repoId` (`repoRegistry.ts:195-218`).
  Deterministic across deployments given the same URL.
- Phases 122–126 give the server users, hashed api_keys/sessions,
  `repo_grants` (`read`/`write`/`owner`, optional branch glob), `orgs`, an
  `audit_log`, and `repos.visibility` (`private`/`public`) with an
  attach-as-reader auto-grant flow (`role: 'reader'`, `source: 'auto-public'`)
  for public repos.

### 2.4 Storage abstraction (Phases 101–103)

- All index access goes through `MetadataStore`/`VectorStore`/`FtsStore`
  (`src/core/storage/types.ts`). The bundle is inherently a **sqlite-file
  artifact**; `storage migrate` today supports sqlite → {sqlite, postgres,
  qdrant} only, which conveniently matches the natural import path for
  non-sqlite deployments (import bundle to sqlite, migrate).

### 2.5 What the withdrawn federation design got right

Its "Layer 2" observed that semantic state can ride Git's own transport
(`refs/sema/*` refs, packfile-like bundles fetchable offline via "email, S3,
etc."). This design keeps the *artifact* framing and the *git-native option*
(as a deferred transport, §7), and drops the peer network, query routing, and
gossip entirely.

---

## 3. Conceptual model & options considered

Three independent axes, each with real alternatives:

### Axis A — Artifact format

| Option | Description | Verdict |
|---|---|---|
| **A1. Evolve the Phase 54 tar.gz bundle** (manifest v2) | Keep `tar.gz(sqlite db + VSS files + manifest.json)`; enrich the manifest with provenance; add a *delta* variant whose payload is a small sqlite DB containing only new rows | ⭐ chosen |
| A2. New manifest-led custom format (row-oriented binary/JSONL "semantic packfile") | Fresh serialization of blobs/embeddings/chunks à la federation's packfiles | Rejected: reinvents serialization sqlite already does; every reader/writer needs new code; loses free migrations-on-open |
| A3. Ship the raw `.gitsema/` directory (rsync/scp convention) | No format at all | Rejected: no integrity, no provenance, no delta story, WAL-file footguns |

A1 wins because sqlite **is** the serialization: `INSERT OR IGNORE` over
content-addressed, blob-keyed rows makes delta application idempotent and
order-independent for free, and `openDatabaseAt()` already gives
schema-version validation + migrations on import. A delta bundle is just a
second sqlite file with the same schema and only the new rows — no new parser
anywhere.

### Axis B — Resolution/discovery (how `attach` finds a bundle)

| Option | Description | Verdict |
|---|---|---|
| **B1. Layered convention: explicit URL → config template → well-known locations** | `--from <url>` wins; else `bundles.url` config; else try the configured gitsema server's `/bundles/<repoId>/`, else the repo's forge-release convention | ⭐ chosen |
| B2. Central registry service | A new hosted "bundle registry" mapping repo URL → bundle URL | Rejected: a new service to run is exactly what this design exists to avoid; Semahub can layer one later |
| B3. Git ref namespace only (`refs/gitsema/bundles/*`) | Bundle rides the git remote itself, inheriting its auth/hosting | Deferred (§7): elegant (zero extra infra, auth for free) but pushes multi-hundred-MB binary objects into git remotes, which some forges throttle/forbid; not needed for v1 |

Discovery within a location uses one small **bundle-index file**
(`gitsema-bundles.json`): a manifest-of-manifests listing available bundles
(full + deltas) with their tips, base commits, embed configs, sizes, and
checksums. `attach` fetches this one file, picks the best chain (see §4.4),
then downloads only what it needs. Static, cacheable, CDN-friendly.

### Axis C — Who serves bytes

| Option | Description | Verdict |
|---|---|---|
| **C1. Any static HTTPS host** (GitHub Releases, S3, artifact stores) | Publisher uploads bundle + bundle-index; consumers GET | ⭐ chosen as the baseline — zero-server loop |
| **C2. `gitsema tools serve` as a bundle origin** | New `GET /bundles/:repoId[/:name]` routes streaming the artifacts, gated by existing grants | ⭐ also chosen — additive; turns the server from "answers every query" into "hands out the index once per consumer" |
| C3. Peer-to-peer swap between consumers | — | Rejected: withdrawn with federation; out of scope permanently for this design |

C1 and C2 are complements, not competitors: the format and bundle-index are
identical in both; C2 just adds an authenticated origin for private repos.

---

## 4. Chosen direction

### 4.1 Bundle manifest v2

`manifest.json` inside the tar.gz grows from Phase 54's four fields to:

```jsonc
{
  "bundleFormat": 2,                  // 1 = Phase 54 (absent field ⇒ 1)
  "kind": "full",                     // "full" | "delta"
  "schemaVersion": 32,                // sqlite schema version, as today
  "checksums": { "index.db": "…" },   // sha256 per file, as today
  "createdAt": 1720512000,

  // Repo identity (Git stays the source of truth: identity is the
  // normalized remote URL + a commit hash; nothing here restates Git data)
  "repo": {
    "normalizedUrl": "github.com/acme/widget",
    "repoId": "3fa1b2c4d5e6f708"      // deriveRepoId(normalizedUrl), repoRegistry.ts
  },
  "tipCommit": "abc123…",             // history is fully indexed up to here
  "baseCommit": null,                 // delta only: consumer must already have ≥ this

  // Embed-config provenance: verbatim embed_config rows (one DB may hold
  // several models). configHash is computeConfigHash() over the same seven
  // keys as today — no new version string is invented. Quantization is not
  // part of configHash (see §2.2) so it is carried alongside, per config.
  "embedConfigs": [
    {
      "configHash": "…",
      "provider": "http", "model": "text-embedding-3-small",
      "codeModel": null, "dimensions": 1536,
      "chunker": "file", "windowSize": null, "overlap": null,
      "quantized": false
    }
  ],
  "profileName": "default",           // server-published bundles: repos.profile_name; null for local exports

  "signature": null                   // reserved; see §7 (deferred)
}
```

Import behavior by `bundleFormat`:
- Absent/`1`: legacy path, unchanged (overwrite + migrate).
- `2` + `kind: "full"`: verify checksums; refuse if the target `.gitsema/`
  already has an index whose `embed_config` set conflicts under
  `checkConfigCompatibility()` semantics (same model, different dimensions)
  unless `--force`; then overwrite + migrate, as today.
- `2` + `kind: "delta"`: see §4.3.

### 4.2 What a full bundle is

Unchanged from Phase 54 physically: the whole `index.db` + VSS sidecars. A
full bundle for a server-hosted repo is naturally single-profile (server DBs
are per-repo with a pinned `profile_name`); a locally exported bundle may
carry several `embedConfigs`, and the manifest says so. The misleading
`--after`/`--since` flags on `index export` are **deprecated** in favor of
`--delta` (they never actually filtered — §2.1); per `docs/deprecations.md`
policy they keep working with a warning, and the deprecation registry gets a
row when this ships.

### 4.3 Delta bundles

`gitsema index export --delta --base <commit> --out <file>`:

1. Enumerate commits in `(base, tip]` via `git rev-list base..tip` (streaming,
   like the indexer — never buffer history).
2. Collect the row-set reachable from those commits that a consumer at `base`
   cannot already have: new `blobs`, their `embeddings` / `chunks` /
   `chunk_embeddings` / `symbol(_embeddings)` / `structural_refs` /
   `blob_fts` content / `paths`, plus the new `commits`, `blob_commits`,
   `indexed_commits`, `blob_branches` rows.
3. Write them into a fresh sqlite file **with the same schema** (reuse
   `openDatabaseAt()` on a temp path so migrations/DDL stay single-sourced),
   tar it with a `kind: "delta"` manifest carrying `baseCommit` + `tipCommit`.

`index import` on a delta: verify the local index's `indexed_commits` contains
`baseCommit` (else error with a pointer to the needed full bundle); `ATTACH`
the delta DB and apply `INSERT OR IGNORE` per table. Because every row pivots
on `blob_hash` (blob-first constraint), application is **idempotent and
tolerant of overlap** — re-importing a delta, or importing overlapping deltas,
is harmless. Derived state that is rebuilt rather than merged (VSS index,
`graph_nodes`/`edges`, `module_embeddings`, cluster snapshots) is *excluded*
from deltas; import prints which rebuild commands apply (`index build-vss`,
`graph build`, `index update-modules`) — same recompute-locally convention the
knowledge-graph layer already uses.

Embed-config gate on delta import: every `configHash` in the delta manifest
must already exist in the local `embed_config` table (a delta is a
continuation, not a mixer). Mismatch → error suggesting the matching full
bundle. Quantization: reads tolerate mixed quantization (dequantize-at-read,
§2.2), so delta import only *warns* when `quantized` differs; continuing to
*index locally* on top keeps today's `--allow-mixed` behavior.

### 4.4 Bundle index + resolution (`gitsema index attach`)

A **bundle-index file** `gitsema-bundles.json` sits next to the bundles:

```jsonc
{
  "formatVersion": 1,
  "repo": { "normalizedUrl": "…", "repoId": "…" },
  "bundles": [
    { "kind": "full",  "tipCommit": "…", "embedConfigHashes": ["…"], "profileName": "default",
      "url": "gitsema-full-<cfg12>-<tip12>.tar.gz", "size": 123456789, "sha256": "…" },
    { "kind": "delta", "baseCommit": "…", "tipCommit": "…", "embedConfigHashes": ["…"],
      "url": "gitsema-delta-<cfg12>-<base12>-<tip12>.tar.gz", "size": 4567890, "sha256": "…" }
  ]
}
```

(`<cfg12>`/`<tip12>` = first 12 hex chars of configHash / commit — display
convention only; the manifest inside is authoritative.)

`gitsema index attach [<repo-url>]` resolution order:

1. `--from <url>` — a bundle-index URL, a direct bundle URL, or a local path.
2. Config `bundles.url` / `GITSEMA_BUNDLE_URL` — a URL template supporting
   `{repoId}` / `{normalizedUrl}` substitution (covers S3/artifact-store
   conventions).
3. The configured gitsema server (`remoteUrl` config /`GITSEMA_REMOTE`):
   `GET /bundles/{repoId}/gitsema-bundles.json` (§4.5).
4. Forge convention for the repo's `origin`: on GitHub, a rolling release
   tagged `gitsema-index` whose assets are the bundle-index + bundles
   (asset download inherits GitHub's own repo auth — private repos work with
   no gitsema-side auth at all).

Having fetched a bundle-index, `attach` picks the cheapest valid chain: exact
tip match → newest full bundle ≤ HEAD plus its delta chain → nearest ancestor
full bundle + **local incremental `index start` for the remainder** (the
existing `--since <last indexed commit>` path makes this free). If nothing
resolves, `attach` falls back to plain local indexing — attach is always safe
to run, never worse than the status quo. `--offline`/`--no-fallback` variants
gate each half. Profile/config selection: `attach` filters candidates to
bundles whose `embedConfigs` match the caller's resolved embed config
(provider/model/dimensions/chunker per `computeConfigHash()`), with
`--any-config` to take whatever is offered when the consumer is read-only.

`gitsema index publish` is the inverse: export (full or `--delta` from the
last published tip recorded in the fetched bundle-index), upload to the
resolved destination, and rewrite `gitsema-bundles.json` (locally it just
writes both files to `--dest <dir>`; the GitHub-release upload lives in the CI
action, Phase E, keeping the CLI free of forge-API dependencies).

### 4.5 Server-side bundle serving

`gitsema tools serve` gains three additive routes (new
`src/server/routes/bundles.ts`):

- `GET /bundles/:repoId/gitsema-bundles.json` — the bundle index.
- `GET /bundles/:repoId/:bundleName` — streams the artifact
  (`ETag: sha256`, `Cache-Control: public, max-age=…` for public repos so a
  CDN/reverse proxy can absorb the fan-out).
- `POST /bundles/:repoId/rebuild` — (owner/admin) materialize a fresh full
  bundle from the repo's `index.db`; also run automatically after a
  `remote-index` job completes when `bundles.autoPublish` is set (server
  keeps last N full bundles + deltas between them; N configurable,
  default 2).

**Auth is exactly Phases 122–126 — nothing new.** Bundle routes require the
same `read` grant as query routes for private repos; public repos
(`visibility: 'public'`) allow anonymous/any-authenticated fetch and trigger
the existing attach-as-reader auto-grant (`source: 'auto-public'`) for
authenticated callers, identical to the Phase 126 registration path. The
governing invariant, stated once and enforced in the route: **a bundle
contains the repo's full text (FTS content), so bundle access must be at
least as strict as repo read access.** Bundle downloads are `audit_log`-worthy
events (same shape as grant/token events).

### 4.6 Storage-backend scope

Bundles are sqlite artifacts in v1, on both ends. Postgres/qdrant deployments
consume a bundle via *import to a temp sqlite DB → `storage migrate`* — which
is exactly the direction `storage migrate` already supports (sqlite sources
only). Direct non-sqlite export/import is out of scope until someone actually
needs it (§7).

### 4.7 Fit with the design constraints

- **Git is the source of truth** — the manifest stores only commit hashes and
  the normalized remote URL; nothing Git knows is restated.
- **Blob-first** — deltas are blob-keyed row sets; `INSERT OR IGNORE` on
  content-addressed keys is what makes merge trivial.
- **Immutable embeddings** — extended across machines: attach *is* the dedup
  check at fleet scale.
- **Streaming** — delta export walks `rev-list` streaming; import should
  stream tar entries to disk (fixing the current buffer-whole-file-in-memory
  import as part of Phase A).
- **CLI-first** — everything is `gitsema index <sub>`; server routes and the
  CI action are thin wrappers over the same `bundleIndex.ts` core.

---

## 5. Phased implementation plan

Sized like existing PLAN.md phases; numbering assigned later by phase-plan.
Phases A–B are pure CLI/local; C–E add distribution. Each is independently
shippable.

**Phase A — Manifest v2 + import hardening (~250–350 LOC)**
- Extend `exportIndex`/`importIndex`: write/read `bundleFormat: 2` manifests
  with repo identity, `tipCommit`, `embedConfigs` (+ per-config `quantized`),
  `profileName`; keep reading format-1 bundles.
- Import: config-compatibility gate (§4.1), stream-to-disk extraction,
  `PRAGMA quick_check` before declaring success.
- Deprecate `index export --after/--since` (warning + `docs/deprecations.md`
  row; flags keep annotating as today).
- Tests: round-trip with manifest assertions; legacy-bundle import; conflict
  refusal. Changeset (minor).

**Phase B — Delta bundles (~400–550 LOC)**
- `index export --delta --base <commit>`: streaming row-set collection
  (§4.3), same-schema delta DB via `openDatabaseAt()` on a temp path.
- `index import` delta path: base-commit precondition, `ATTACH` +
  `INSERT OR IGNORE` per table, derived-state rebuild hints.
- Tests: integration — index repo at C1, export full; advance to C2, export
  delta; fresh clone imports full+delta ≡ indexing C2 directly (compare
  blob/embedding counts + a search result); idempotent re-import.

**Phase C — `index attach` / `index publish` + HTTPS resolution (~450–600 LOC)**
- `gitsema-bundles.json` read/write; resolution ladder §4.4 (explicit URL →
  `bundles.url` template → gitsema server → GitHub `gitsema-index` release
  via plain asset URLs); chain planner (full → deltas → local catch-up);
  fallback to local indexing.
- New config keys: `bundles.url`, `bundles.requireChecksum` (default true).
- Tests: resolution-order unit tests with a mocked fetch; chain-planning
  cases (exact tip / delta chain / ancestor + catch-up / nothing).
- README + features.md + parity.md (new subcommands are CLI-only initially —
  record that consciously in the parity matrix).

**Phase D — Server bundle routes + auth integration (~350–500 LOC)**
- `src/server/routes/bundles.ts` (§4.5): index/artifact GET with grant
  checks + attach-as-reader on public repos, ETag/Cache-Control, streamed
  responses; `POST …/rebuild`; `bundles.autoPublish` + retention (keep-N).
- `audit_log` entries for bundle downloads/rebuilds.
- Tests: `serverRoutes.test.ts` additions — private 401/403, public
  anonymous fetch, auto-grant row created, ETag revalidation.

**Phase E — CI action + zero-server loop docs (~150–250 LOC + workflow)**
- A reusable GitHub Action (composite or small JS) — checkout → restore
  previous bundle via `index attach` → `index start` (incremental) →
  `index publish --delta` → upload assets to the rolling `gitsema-index`
  release.
- Docs: "index once, serve many" guide in README/features.md; deploy.md
  section for putting a CDN in front of `/bundles`.

Total: five phases, roughly 1,600–2,250 LOC + tests/docs — comparable to the
multi-tenant-auth track's per-phase sizing.

---

## 6. Decisions taken autonomously (pending user review)

This refinement ran non-interactively; every product/scope call the skill
would normally ask about was resolved from codebase evidence + stated
constraints. Each is revisitable before phase-plan.

1. **Evolve the Phase 54 bundle rather than a new format** (Gap: artifact
   format). Rationale: sqlite is already the serialization and gives
   idempotent `INSERT OR IGNORE` deltas + migrations-on-open for free
   (§3-A1); a custom packfile format was the withdrawn design's path and adds
   parser surface for zero benefit at these sizes.
2. **Deltas as same-schema sqlite files applied via `ATTACH` +
   `INSERT OR IGNORE`**, excluding derived/rebuildable state (VSS, graph,
   module centroids, clusters). Rationale: blob-first keys make this
   idempotent; derived state already has recompute commands.
3. **Compatibility key = the existing `embed_config` tuple/`configHash`, with
   `quantized` carried alongside per config — `computeConfigHash()` itself is
   NOT changed.** Rationale: the task and Phase 128 both say derive from
   `embed_config`, don't invent a version string; changing the hash would
   orphan every existing `embed_config` row. Quantization can't go *into* the
   hash for the same reason, and read paths dequantize anyway, so it gates
   only continued indexing (warn, keep `--allow-mixed` semantics) (§2.2,
   §4.3).
4. **Deprecate `index export --after/--since`** rather than implementing real
   time-sliced export. Rationale: verified the flags never filtered
   (§2.1) — commit-range deltas subsume the use case with correct semantics;
   "warn forever" per deprecations.md policy.
5. **Command names: `gitsema index attach` and `gitsema index publish`**
   (subcommands, not top-level; the feature-ideas entry left the name TBD).
   Rationale: keeps the CLI-first surface inside the existing `index` group
   (no `src/cli/index.ts` top-level addition), sits beside
   `export`/`import` which they orchestrate, and "attach" deliberately echoes
   Phase 126's attach-as-reader semantics — same product concept, artifact
   edition.
6. **Resolution = layered convention (explicit URL → config template →
   gitsema server → GitHub rolling release), one static
   `gitsema-bundles.json` per location; no registry service** (Gap:
   resolution). Rationale: a registry is a new server, which this design
   exists to avoid; the ladder covers S3/artifact-store/self-hosted/forge
   cases with only static files. Forge convention chosen: rolling release
   tagged `gitsema-index` (release assets are the only forge artifact type
   that is plain-HTTPS-fetchable, size-tolerant, and auth-inherited).
7. **v1 trust = per-file sha256 (already present) + bundle-index sha256 +
   HTTPS channel/forge auth; signatures deferred** with a reserved manifest
   `signature` field and a concrete deferred proposal (`ssh-keygen -Y`
   detached signatures — Git's own signing tooling, zero new deps) (Gap:
   integrity/trust). Rationale: v1 publishers are the repo owner or their
   CI, where channel trust ≈ code trust (anyone who can tamper with the
   bundle asset can tamper with the code itself); third-party mirrors are
   the real signing use case and aren't in v1. Added `PRAGMA quick_check`
   on import since a sqlite file from the network is parser attack surface.
8. **Private-repo auth = exactly the Phases 122–126 grant model, with the
   invariant "bundle access ≥ repo read access"** because bundles embed full
   FTS text; public repos reuse the attach-as-reader auto-grant path
   unchanged (Gap: auth interplay). No new credential type, no signed URLs
   in v1.
9. **Bundles stay sqlite-only in v1; non-sqlite deployments go through
   `storage migrate`** — matching the migrate command's existing
   sqlite-source-only support (§4.6).
10. **Git-ref-namespace transport (`refs/gitsema/bundles/*`) deferred, not
    rejected** — kept as the one salvageable federation transport idea, but
    v1 needs no git-remote write path (§7).

---

## 7. Remaining open questions

Deliberately deferred — these need either real usage data or a prototype, not
more desk design:

1. **Signatures & key distribution.** When third-party bundle mirrors appear,
   who signs, where do consumer trust anchors live (`bundles.trustedSigners`
   config? allowed-signers file à la git), and does `attach` hard-fail or
   warn on unsigned? The manifest field is reserved; the policy is not
   designed.
2. **Git ref namespace transport.** Worth building only if a hosting pattern
   emerges where releases/S3 are unavailable but git push access exists.
   Costs: large binaries in remotes, forge quota policies.
3. **Server retention/GC tuning.** Keep-N full bundles is a placeholder;
   real deployments may want size-based caps or delta-chain compaction
   (merge k deltas into one). Decide after Phase D telemetry.
4. **Multi-profile publishing ergonomics.** Server repos are single-profile
   (pinned), so one bundle chain per repo suffices there; a *local* publisher
   with a deliberately multi-model DB currently publishes one chain carrying
   all configs. Whether anyone wants per-config split bundles is unknown.
5. **VSS sidecar deltas.** usearch indexes are rebuild-only in this design
   (excluded from deltas). If rebuild time at large blob counts proves
   painful for attachers, revisit shipping the sidecar in full bundles only
   at first (it already is) vs. incremental HNSW updates.
6. **Direct non-sqlite bundle import** (postgres/qdrant without the temp-
   sqlite hop) — only if the two-step path proves operationally annoying.

---

## 8. Relationship to other documents

- Supersedes the "Prebuilt Index Distribution" entry in
  `docs/feature-ideas.md` (now a pointer here).
- Background only: `docs/design/semantic-federation.md` (⛔ withdrawn) — §2.5
  lists what was kept; nothing else from it applies.
- Builds on: `docs/public-repo-sharing-plan.md` (visibility/attach-as-reader),
  `docs/locked-model-set-plan.md` (profiles/`repos.profile_name`),
  `docs/multi-tenant-auth-plan.md` (grants/audit),
  `docs/storage-backends-plan.md` (sqlite-artifact scope, §4.6).
- On shipping Phase A: add the `index export --after/--since` row to
  `docs/deprecations.md`; update `docs/parity.md` for the new subcommands
  (CLI-only at first, by decision); changeset per phase.
