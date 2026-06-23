# Superadmin-Locked Model Set

**Status:** draft
**Target phases:** Phases 128–130 (`docs/PLAN.md` "Superadmin-Locked Model
Set Track") — Phase 129 hard-depends on `docs/multi-tenant-auth-plan.md`'s
role model (a superadmin/admin-capability concept does not exist anywhere
in gitsema today; see §2).
**Scope:** (a) a server-curated set of named **embedding profiles** a
multi-tenant `gitsema tools serve` deployment can offer, pinned per-repo at
first-index time and immutable after; (b) the existing narrator/guide
multi-model picker gaining superadmin/org-level allow/deny control plus a
clarified, never-persisted BYOK path. **Out of scope:** the superadmin role
itself (defined by `multi-tenant-auth-plan.md`), and any Semahub-layer
billing/quota tied to model choice.

---

## 1. Motivation

On a single-tenant, self-hosted gitsema deployment, "which embedding model
am I using" is a non-question — the operator sets `GITSEMA_MODEL`/
`GITSEMA_TEXT_MODEL`/`GITSEMA_CODE_MODEL` once and that's the model,
forever, for that one index (CLAUDE.md design constraint #3: embeddings are
immutable, never recomputed without `--since all`). `docs/feature-ideas.md`'s
originating idea assumed a multi-tenant server already has the opposite
problem — many users each picking their own model and corrupting a shared
index's vector space — but research for this doc (§2) found that's not
actually possible today: the server's embedding provider is a **single
process-wide singleton** built once at startup, with no per-request
override at all. So today's "allowed model set" is trivially and
unconditionally "whatever the operator started the process with" — there is
nothing to lock, because there is nothing to choose from.

Per the answered design question, this doc therefore designs the thing that
*would* make a picker meaningful: letting one server process offer **several
named embedding profiles at once**, so different repos/orgs on the same
server can use different models without breaking any single repo's internal
vector-space consistency — and only *then* does "superadmin curates which
profiles are allowed, user picks among the allowed ones" become a real
feature rather than a no-op. The narrator/guide side is the opposite case:
it's *already* multi-model today (`embed_config` `kind='narrator'/'guide'`),
so that half of this doc is about adding admin control and BYOK clarity to
an existing capability, not building a new one.

---

## 2. Current state (verified against source)

| Claim | Evidence |
|---|---|
| Embedding model choice is a single process-wide singleton, built once at server startup, with **no per-request override** | `resolveModels()`, `src/cli/lib/provider.ts:57-69`, called once in `src/cli/commands/serve.ts:45-48`; provider instances passed into `createApp()` as constructor deps, `src/server/app.ts:71-98`; no `model` field accepted anywhere in `POST /remote/index`'s body handling, `src/server/routes/remote.ts` |
| Provider objects are cheap, stateless HTTP wrappers — holding N of them simultaneously in one process is safe and inexpensive | `EmbeddingProvider` interface, `src/core/embedding/provider.ts:3-8` (pure `embed`/`embedBatch`/`dimensions`/`model`, no shared mutable state); `HttpProvider`/`OllamaProvider`, `src/core/embedding/http.ts:18-67`, `src/core/embedding/local.ts:30-66` — no connection pooling, no per-instance resource limits |
| Embeddings are already stored keyed by `(blob_hash, model)`, not just `blob_hash` — multiple models' vectors already coexist in one DB without collision | `embeddings`/`chunkEmbeddings`/`symbolEmbeddings`/`commitEmbeddings`/`queryEmbeddings` composite-key schemas, `src/core/db/schema.ts:75-87, 18-28, 215-225, 302-312, 138-145` |
| "One model per repo, permanently, unless explicitly overridden" is already mechanically enforced, just not yet *scoped per offered profile* | `checkConfigCompatibility()`, `src/core/indexing/provenance.ts:100-133`, rejects re-indexing with a same-named model at a different dimension unless `--allow-mixed` (`src/cli/commands/index.ts:595`) |
| `repos` table has no field recording which profile/model a repo is pinned to | `src/core/db/schema.ts:36-52` — no `profileName`/equivalent column |
| Narrator/guide models are *already* multi-model: named configs in `embed_config` (`kind: 'narrator'\|'guide'`), active selection per-repo in `settings` | `src/cli/commands/models.ts:624-779` (`modelsKindAddCommand`/`modelsKindActivateCommand`); `embed_config.kind`/`paramsJson` columns, `src/core/db/schema.ts:359-383`; active-selection keys `'active_narrator_model_config_id'`/`'active_guide_model_config_id'` in `settings`, `src/core/narrator/resolveNarrator.ts:137,166-170,228` |
| No admin role or admin-only route exists anywhere in the server today | grep for `admin` under `src/server/` — no matches; auth is exactly `GITSEMA_SERVE_KEY` (global) + `repo_tokens` (per-repo scoped), `src/server/middleware/auth.ts` |

**Conclusion:** the embedding half of this idea needs *new* architecture
(multi-profile serving); the narrator/guide half needs only admin-gating
and BYOK-handling added on top of an existing mechanism. Both halves are
fully blocked on a superadmin/role concept that doesn't exist yet.

---

## 3. Conceptual model

**Axis A — Embedding profile multiplicity.** Per the answered design
question, the server is extended to hold several named embedding profiles
simultaneously (e.g. `{name: "openai-small", provider: "http", textModel:
"text-embedding-3-small", ...}`, `{name: "local-ollama", provider: "ollama",
textModel: "nomic-embed-text", ...}`), each resolved to its own
`textProvider`/`codeProvider` pair at server startup via repeated
`resolveModels()`/`buildProvider()` calls (§2 confirms this is cheap). A
repo is pinned to exactly one profile at its first index, recorded
alongside the existing provenance the indexer already tracks, and stays
pinned forever for that repo (mirrors today's single-model-per-index
invariant — this doc doesn't relax it, it just lets *different repos*
disagree on which model that invariant pins them to).

**Axis B — Who curates the allowed set, and at what granularity.**
Superadmin sets the server-wide list of *enabled* profiles (a subset of
configured profiles, or all of them); per the original idea's already-
answered scoping, an org_admin may *further narrow* (never widen) which of
the server-enabled profiles their org's repos may use. This reuses
`multi-tenant-auth-plan.md`'s org/role model rather than introducing a
second permission system — "allowed profile set" is just another org-scoped
policy value, conceptually parallel to that doc's `repo_grants`.

**Axis C — Picker UX given the allowed set's size.** Per the original
idea's answered question: exactly one allowed profile → shown pre-selected
and disabled wherever a profile would otherwise be chosen (repo
registration, `gitsema index start`); more than one → a real picker scoped
to the allowed set.

**Axis D — Narrator/guide admin control + BYOK.** Unlike Axis A, no new
multi-model machinery is needed here — `embed_config`/`settings` already
support it. This axis is purely: (1) a superadmin/org-admin allow/deny list
over which narrator/guide configs *may be activated* (enforced wherever
`modelsKindActivateCommand`/`setActiveNarratorConfig`/`setActiveGuideConfig`
already run); (2) per the answered design question, BYOK credentials for
narrator/guide are supplied **per-request only and never persisted** —
avoiding the plaintext-secret-at-rest question entirely for the BYOK case,
in contrast to (and explicitly not reusing) the `~/.config/gitsema/
credentials.json` precedent from `multi-tenant-auth-plan.md` §4.1, which is
for the user's own gitsema login credentials, not third-party LLM keys.

---

## 4. Chosen direction

### 4.1 Embedding profiles (new capability)

1. **Server config: named profile list.** A new config shape — e.g.
   `auth.embeddingProfiles` (JSON array) or one config block per profile —
   lets the operator define N profiles at deploy time (provider, text/code
   model, any HTTP URL/key). At server startup, `serve.ts` calls
   `resolveModels()`/`buildProvider()` once per defined profile instead of
   once globally, holding a `Map<profileName, {textProvider, codeProvider}>`
   in the running process (§2 confirms this is cheap to hold).
2. **Superadmin enabled-set.** A superadmin-only admin route/CLI marks
   which of the *defined* profiles are *enabled* server-wide (defined ≠
   enabled lets an operator stage a profile before rolling it out). An
   org_admin may narrow further for their org (never widen past the
   server-wide enabled set).
3. **Per-repo pinning.** Add `profileName` (nullable TEXT) to `repos`
   (`src/core/db/schema.ts:36-52`) — set once, at the repo's first
   successful index, to whichever profile resolved the request. Subsequent
   index requests for that repo are routed to that same profile's provider
   pair regardless of what the caller's org currently has enabled (a repo
   already pinned to a profile that's later disabled keeps working for
   reads/incremental refresh — disabling a profile only blocks *new* repos
   or repos not yet pinned from selecting it; it does not retroactively
   break existing ones, consistent with CLAUDE.md's "never recompute"
   embeddings constraint).
4. **Reuse existing provenance enforcement.** `checkConfigCompatibility()`
   (`provenance.ts:100-133`) already rejects a same-named model re-indexed
   at a different dimension; this doc adds no new enforcement mechanism
   for *within-repo* consistency, only the *which-profile-applies-to-this-
   repo* routing layer described above.
5. **Picker UX (Axis C):** the registration/`index start` CLI path checks
   the caller's effective allowed-profile set (server ∩ org narrowing); one
   entry → proceed with it pre-selected, no flag needed; multiple → require
   `--profile <name>` (or interactive prompt in `gitsema setup`/
   `quickstart`).

### 4.2 Narrator/guide admin control + BYOK (extends existing capability)

1. **Allow/deny list**, keyed by `embed_config.id` or by `(provider,
   model)` pair, checked inside `modelsKindActivateCommand` and the
   equivalent HTTP path before honoring `setActiveNarratorConfig`/
   `setActiveGuideConfig`. Superadmin manages the server-wide list;
   org_admin narrows for their org — same Axis B pattern as embeddings, one
   shared enforcement shape rather than two.
2. **"Lock to none."** An explicit valid server posture (already named in
   the original idea): the allow-list can be empty, meaning no
   server-provided narrator/guide model is available to any user — BYOK
   becomes the *only* way to use `narrate`/`explain`/`guide` at all on that
   server.
3. **BYOK, never persisted.** Per the answered design question, a BYOK
   request supplies its own `httpUrl`/`apiKey`/`model` inline with the
   `narrate`/`explain`/`guide` call (e.g. a request body field or header on
   the existing `POST /narrate`/`POST /guide` routes) and the server
   constructs a one-off provider for that single call via the existing
   `createNarratorProviderFor()` (`resolveNarrator.ts:183-194`) without ever
   calling `saveEmbedConfig`/writing to `embed_config`/`settings`. This is
   a deliberate divergence from the *stored* narrator/guide config path —
   BYOK configs are request-scoped, not config-row-backed.

---

## 5. Phased implementation plan

**Phase 1 — Multi-profile embedding serving (~500–700 LOC)**
- Server config shape for N named profiles; `serve.ts` builds a provider
  map instead of a single pair.
- `repos.profileName` column + migration.
- Profile-routing layer in the registration/index-job path
  (`remote.ts`/`repoRegistry.ts`): resolve effective allowed set →
  pre-select or require `--profile`.
- CLI: `gitsema index start --profile <name>`, `gitsema repos info`
  surfaces the pinned profile.
- Tests: two profiles configured, two repos pinned independently, verify
  no cross-contamination; verify a repo stays on its pinned profile after
  that profile is later disabled.
- **No hard dependency on the role model for this phase's mechanics** (the
  provider-map plumbing works without roles) but the admin/org enabled-set
  pieces below do depend on it.

**Phase 2 — Admin-gated enabled sets (embedding + narrator/guide), ~350–500 LOC**
- Superadmin admin CLI/route (exact shape TBD — see §6) to enable/disable
  defined profiles and narrator/guide configs server-wide.
- Org-level narrowing, reusing `multi-tenant-auth-plan.md`'s `orgs`/role
  checks.
- Picker UX: pre-selected/disabled single-choice vs. real picker, applied
  to both embedding profile selection and narrator/guide activation.
- **Hard dependency:** `multi-tenant-auth-plan.md` Phase A (users) and
  Phase B (orgs/roles) — there is no superadmin/org_admin to gate against
  before then.

**Phase 3 — BYOK for narrator/guide (~150–250 LOC)**
- Request-scoped credential field on `narrate`/`explain`/`guide`
  CLI/HTTP/MCP entry points.
- One-off provider construction via `createNarratorProviderFor()`, no
  persistence path.
- "Lock to none" support (empty allow-list is a valid, tested state).
- **No hard dependency on Phase 1**; benefits from Phase 2's allow-list
  existing (so "lock to none" has something to be empty) but could ship
  standalone if Phase 2 stalls.

**Total estimated effort: ~1000–1450 LOC** across all three phases.
Phase 1 is the only piece introducing genuinely new architecture; Phases 2
and 3 are policy/admin layers on top of existing or newly-built mechanisms.

---

## 6. Remaining open questions

- **Exact admin CLI/API shape.** `gitsema admin models allow/deny --kind
  embedding|narrator|guide` vs. HTTP-only `/api/v1/admin/...` routes vs.
  both — left open pending `multi-tenant-auth-plan.md`'s settling on its
  own admin/CLI conventions (e.g. `gitsema auth`/`gitsema orgs` naming
  patterns), so this doc's admin surface matches rather than invents a
  third style.
- **Personal groups and profile narrowing.** Does a personal group
  (`multi-tenant-auth-plan.md` §4.2a) get its own narrowing rights like a
  team org, or always inherit the server-wide enabled set unmodified? Not
  resolved here — leaning toward "inherits unmodified" (a one-member org
  narrowing its own access seems like a strange UX, since there's no one
  else to protect from a wider set), but this is a real product call.
- **Profile *removal* (not just disabling).** Disabling a profile leaves
  existing pinned repos working (per §4.1.3); this doc doesn't address what
  happens if an operator wants to fully *delete* a profile's config (and
  thus its provider credentials) while repos are still pinned to it —
  likely "you can't delete, only disable, while any repo references it,"
  but not designed in detail.
- **Web-dashboard surfacing.** Same caveat as the original feature-ideas.md
  entry — whether/how the (nonexistent) Semahub dashboard needs to mirror
  this picker UX is explicitly Semahub Layer 2 territory, not this doc's
  concern.
