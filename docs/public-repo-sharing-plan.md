# Public Repo Sharing: Visibility & Attach-as-Reader

**Status:** draft
**Target phases:** proposed, no numbers assigned yet — depends on
`docs/multi-tenant-auth-plan.md` Phase A (users/sessions) and Phase B
(`orgs`/`repo_grants`) landing first; see §5.
**Scope:** the access-control layer on top of `gitsema tools serve`'s
existing per-URL repo registry — a `visibility` flag, auto-granted read
access when a second user attaches to an existing public repo's shared
index, and abuse-resistant gating of who can trigger a first-time index vs.
a refresh. **Out of scope:** cross-repo blob-level dedup for forks with
different URLs (this doc's "shape 2" in the originating feature-ideas.md
entry) — that remains a separate, larger, undesigned idea; see §6.

---

## 1. Motivation

`docs/feature-ideas.md`'s "Shared/Deduplicated Indexing for Public Repos"
entry was written from the concern that on a shared server, N users
registering the same public repo URL would each trigger a full clone +
full embed — "ten times the storage and compute for content that is
byte-for-byte identical." Researching the actual registry code
(`src/core/indexing/repoRegistry.ts`) shows **that specific worry is
already solved**: registrations are deduplicated by normalized URL today,
and indexing is already incremental and blob-hash-deduped, so a repeat
registration of an already-indexed URL is cheap, not a tenth of the
original cost. See §2 for the exact mechanism and citations.

What's still genuinely missing is **access control**, not storage dedup:
- There is no notion of a repo being "public" — every repo is reachable
  only by the global `GITSEMA_SERVE_KEY` or a per-repo `repo_tokens` row
  scoped to exactly that one `repoId` (`src/core/db/schema.ts:404-410`).
  Nothing lets a second, unrelated user "find and read" an existing
  public repo's index without already holding (or being handed) a
  scoped token for it.
- There is no automatic grant issued when a user's registration request
  resolves to an *existing* repo rather than creating a new one — today
  that path either 403s (scoped tokens can't register repos they don't
  already own a token for — `src/server/routes/remote.ts:535-543`) or
  silently proceeds under the global key with no record of *who* is now
  reading that repo.
- There is no gate on *who* may trigger the **first** full index of a
  brand-new public URL — this is the real shape of the "for the giggles"
  abuse concern: not repeat-indexing an existing repo (cheap, already
  deduped), but many different unrelated users each being able to
  unilaterally kick off the **first**, expensive full clone+embed of an
  arbitrary public URL with no coordination or authorization step.

This doc designs that access-control layer: a `visibility` flag, an
attach-as-reader flow that auto-issues a `repo_grants` row, and a
first-index gate plus a refresh-rate limit — all building directly on the
`users`/`orgs`/`repo_grants` model from `docs/multi-tenant-auth-plan.md`
rather than inventing a parallel permission system.

---

## 2. Current state (verified against source)

| Claim | Evidence |
|---|---|
| Same normalized URL always resolves to the same `repoId`, clone path, and index DB — no duplicate clones today | `normalizeRepoUrl()` / `deriveRepoId()` / `findRepoByNormalizedUrl()`, `src/core/indexing/repoRegistry.ts:180-217`; lookup-before-create in `src/server/routes/remote.ts:515-554` |
| `repos` table has no owner/org/visibility column | `src/core/db/schema.ts:36-52` — columns are `id`, `name`, `url`, `dbPath`, `addedAt`, `normalizedUrl` (UNIQUE), `clonePath`, `lastIndexedAt`, `ephemeral` only |
| `repos.normalizedUrl` has a UNIQUE index — the dedup key | `src/core/db/schema.ts:36-52` |
| Per-repo access today is binary: global `GITSEMA_SERVE_KEY`, or a `repo_tokens` row scoped to exactly one `repoId` | `src/core/db/schema.ts:404-410`; `src/server/middleware/auth.ts` |
| A scoped (per-repo) token cannot register a *new* repo, only operate on the one it's already scoped to | `src/server/routes/remote.ts:535-543` |
| Concurrent registration requests for the same URL are already race-safe — `deriveRepoId` is a deterministic hash of the normalized URL, so two simultaneous first-time requests compute the *same* `repoId` and queue behind the same `withRepoLock(repoId, …)` | `src/core/indexing/repoRegistry.ts:202-204, 263-289`; `src/server/routes/remote.ts:589` |
| A repeat index run on an unchanged repo is already cheap: incremental `--since <lastIndexedCommit>` resume plus blob-hash dedup mean no new clone/embed work happens | `src/core/indexing/deduper.ts`; `touchLastIndexed()`, `repoRegistry.ts:252-255` — CLAUDE.md design constraint #3 ("Immutable embeddings... never recompute") |
| `blobs`/`embeddings` are keyed by `blob_hash` *within one index DB file*; each repo's index is its own DB file under `$GITSEMA_DATA_DIR/repos/<repoId>/index.db` — no blob sharing *across* repo DBs exists | `src/core/db/schema.ts:30-34` (table defs); per-repo DB file path resolution in `src/core/indexing/repoRegistry.ts` and `src/server/routes/remote.ts:395` |
| `graph_nodes` has an optional, non-enforced `repoId` column (descriptive only, not a per-repo access boundary) | `src/core/db/schema.ts:261-272` |
| A server-wide clone-concurrency semaphore and a per-repo lock already bound resource usage during indexing | `GITSEMA_CLONE_CONCURRENCY` semaphore, `src/server/routes/remote.ts:558-568`; `withRepoLock`, `repoRegistry.ts:263-289` |

**Conclusion:** the storage/clone-duplication half of the original idea
is a non-issue today. The real gap is entirely about *who is allowed to
read, attach to, refresh, or first-create* a shared repo's index — i.e.
authorization, not storage architecture.

---

## 3. Conceptual model

Three independent axes, same shape as `multi-tenant-auth-plan.md`'s
axis-separation approach:

**Axis A — Visibility.** Does a repo registration carry a `public` or
`private` flag at all, and who can set/change it?
- *Considered:* provider API check (ask GitHub/GitLab whether the repo is
  actually public) vs. an explicit flag set by whoever registers it.
- *Chosen (per the answered design question):* **explicit flag at
  registration time**, settable by the registering user (becomes the
  repo's owner — see Axis C) or a superadmin, with no network call to the
  origin host. This avoids provider-specific HTTP clients, works for any
  Git remote (not just GitHub/GitLab), and matches "public" to "the
  registrant chose to share this," which is closer to the actual intent
  (e.g. an internal monorepo mirror nobody wants searchable server-wide,
  even if its *source* host visibility happens to be public) than to the
  origin host's literal ACL.

**Axis B — Attach-as-reader.** When a second user's registration request
resolves (via `normalizedUrl`) to an *existing* repo, what happens?
- *Considered:* (a) silently let them through with no record (today's de
  facto behavior under the global key), (b) reject with 403 unless they
  already hold a grant, (c) auto-issue a reader grant.
- *Chosen:* **(c)** for `public` repos only — attaching to an existing
  public repo's index auto-issues a `repo_grants` row
  (`role: 'reader'`, `source: 'auto-public'`) for the attaching user, so
  there's an auditable record of who's reading it and existing
  `repo_grants`-based authorization checks (per
  `multi-tenant-auth-plan.md` §3 Axis C) just work without a separate
  code path. For `private` repos, behavior is unchanged from today
  (token-scoped only) — visibility doesn't change private-repo
  semantics at all.

**Axis C — Trigger rights.** Who may (a) create — trigger the *first*
full index of a brand-new URL, vs. (b) refresh — trigger an incremental
re-index of an already-registered repo?
- *Considered:* leave both ungated (today's behavior under the global
  key — the actual "for the giggles" abuse vector), vs. gate creation
  only, vs. gate both.
- *Chosen:* **gate creation, rate-limit refresh.** First-time creation of
  a public-flagged repo is the expensive, uncoordinated action and is the
  one worth an explicit opt-in switch (§4). Refresh is already cheap
  (Axis A finding in §2) so it doesn't need an authorization gate, but it
  still gets a minimum-interval throttle per `(user, repoId)` so a bored
  user can't usefully hammer the endpoint even though each call
  individually does almost no work.

---

## 4. Chosen direction

1. **`repos.visibility` column** (`'private' | 'public'`, default
   `'private'`) added to the `repos` table. Only the repo's owner — the
   user whose registration request first created it (the existing
   first-claimer dedup in `repoRegistry.ts` already makes "who created
   it" deterministic) — or a superadmin may change it, via
   `gitsema repos visibility <repoId> public|private`. This requires
   `repos` to gain an `ownerUserId` column too (currently absent per §2),
   set at creation time once `multi-tenant-auth-plan.md` Phase A's
   `users` table exists. A repo owned by a personal group (§4.2a of that
   doc) is just a repo whose owner is that group's sole member — no
   special-casing needed; personal-group-owned repos can be marked public
   the same as any other.

2. **Attach-as-reader on the registration path.** In
   `src/server/routes/remote.ts`'s existing "resolve persistent repo
   registration" block (today: `remote.ts:515-554`), when `existing` is
   found and `existing.visibility === 'public'` and the caller is an
   authenticated user (not the existing owner), auto-insert a
   `repo_grants` row for them (`role: 'reader'`, no `branchPattern`
   restriction by default) instead of proceeding anonymously or 403'ing.
   Private repos keep today's exact behavior — this is additive, not a
   change to the private path.

3. **First-index gate: `auth.allowPublicAutoIndex` config key**
   (`GITSEMA_PUBLIC_AUTO_INDEX` env override), **default `false`** —
   following the same boolean-feature-toggle precedent as
   `auth.personalGroups`. When `false` (default), only a superadmin (or,
   if `multi-tenant-auth-plan.md`'s role model allows it, any user with
   an explicit "can register public repos" capability) may register a
   brand-new URL with `visibility: public`. Registering a *private* repo
   is never gated by this flag — it only affects creating new *public*
   ones, which is the actual abuse surface. When `true`, any authenticated
   user may register a new public repo, accepting that the first index of
   it is real compute/storage cost the operator is choosing to allow.

4. **Refresh throttle: `auth.minReindexIntervalSeconds`** (default e.g.
   `300`). Before acquiring the clone semaphore in `remote.ts`, check
   `lastIndexedAt` for the resolved `persistent.repoId` plus a per-
   `(callerUserId, repoId)` last-triggered timestamp (small new in-memory
   or DB-backed map, same shape as the existing `withRepoLock` map); if
   under the interval, return `429` with `Retry-After` rather than queuing
   another job. This is a small addition independent of everything else
   in this doc and could ship alone as a stopgap per the original
   feature-ideas.md "quota/abuse angle" bullet — see §5 Phase 2, which is
   deliberately separable from Phase 1.

5. **Ownership/ first-claimer semantics stay exactly as they are today** —
   the existing deterministic `deriveRepoId`/`findRepoByNormalizedUrl`
   dedup already decides "who got here first," this doc only adds a
   `visibility` flag and access bookkeeping on top of that existing,
   unchanged mechanism.

---

## 5. Phased implementation plan

**Phase 1 — Visibility flag + attach-as-reader (~300–450 LOC)**
- Schema migration: `visibility` (`'private'|'public'`, default
  `'private'`) and `ownerUserId` columns on `repos`, with an index on
  `(normalizedUrl, visibility)` for the registration lookup.
- `gitsema repos visibility <repoId> public|private` CLI command
  (owner/superadmin only).
- Registration-flow change in `remote.ts`: auto-issue `repo_grants` on
  attach to an existing public repo (per §4.2).
- Tests: dedup + attach-as-reader integration test (two simulated users
  registering the same public URL get one index DB and two grant rows);
  private-repo path unchanged regression test.
- **Hard dependency:** `multi-tenant-auth-plan.md` Phase A (`users`) and
  Phase B (`orgs`/`repo_grants`) must exist first — this phase has
  nothing to attach a grant *to* otherwise.

**Phase 2 — First-index gate + refresh throttle (~150–250 LOC)**
- `auth.allowPublicAutoIndex` / `GITSEMA_PUBLIC_AUTO_INDEX` config key,
  enforced at the top of the registration-resolution block in
  `remote.ts` (before any clone/lock work starts) when the request asks
  for a brand-new `visibility: public` repo.
- `auth.minReindexIntervalSeconds` throttle, enforced just before the
  clone-semaphore acquisition (§4.4).
- Tests: gate rejects unauthorized first-time public registration when
  the flag is off; throttle returns 429 within the interval window and
  succeeds after it elapses.
- **No hard dependency on Phase 1** beyond the `visibility` column
  existing — could theoretically ship first as a standalone hardening
  change if the rest of this doc stalls, per the original feature-ideas
  "quota/abuse angle" bullet.

**Total estimated effort: ~450–700 LOC**, both phases depending on
`multi-tenant-auth-plan.md`'s user/org/grant model landing first (Phase 1
hard-depends on it; Phase 2 only needs the `visibility` column from
Phase 1 itself).

---

## 6. Explicitly out of scope: cross-repo blob-level dedup ("shape 2")

The original feature-ideas.md entry's second, looser shape — recognizing
byte-identical blobs across *different* repo URLs (e.g. forks) and
skipping re-embedding them server-wide — is **not** designed here. Per
the answered scoping question, it remains undesigned and is architecturally
a much bigger lift: `blobs`/`embeddings` are scoped per-repo-DB-file today
(§2), so sharing them globally would mean either restructuring storage to
a shared blob registry + per-repo lookup tables, or a sync/copy mechanism
between DBs — comparable in size to the storage-backends work itself, per
the original effort estimate. `docs/feature-ideas.md` should keep that
shape as its own open, smaller entry (or this doc's pointer should note it
explicitly) rather than implying it's covered by Phase 1/2 above.

---

## 7. Remaining open questions

- **Revocation semantics.** If an owner flips a repo from public back to
  private, do existing auto-issued `repo_grants` rows (issued while it was
  public) get stripped immediately, or grandfathered until explicitly
  revoked? This doc doesn't resolve it — leaning toward "strip
  immediately" for safety (consistent with private repos having zero
  ambient readers), but it's a real product decision the user hasn't
  weighed in on yet.
- **Default `minReindexIntervalSeconds` value.** `300` above is a
  placeholder guess, not a validated number — needs tuning against real
  clone/index timings once implemented.
- **Capability model for "who may register public repos when
  `allowPublicAutoIndex` is false."** §4.3 hand-waves "superadmin, or a
  role with an explicit capability" — the exact role/capability shape
  depends on how `multi-tenant-auth-plan.md`'s role model (and the
  not-yet-designed "Superadmin-Locked Model Set" idea's superadmin
  concept, in `docs/feature-ideas.md`) actually lands; this doc shouldn't
  invent a third, parallel role system ahead of those.
- **Audit logging.** Auto-issued grants and visibility flips are exactly
  the kind of event `multi-tenant-auth-plan.md` §5 Phase D's `audit_log`
  table should record (`repo.visibility.changed`, `repo_grant.auto_issued`
  actions) — not designed in detail here, just flagged for that phase to
  pick up.
