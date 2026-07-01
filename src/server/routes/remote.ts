/**
 * Remote repository indexing route (Phase 16 + Phase 17).
 *
 * Phase 16:
 *   POST /api/v1/remote/index — clone + index, synchronous response (IndexStats)
 *
 * Phase 17 additions:
 *   POST /api/v1/remote/index — returns { jobId } immediately; job runs asynchronously
 *   GET  /api/v1/remote/jobs/:jobId/progress — SSE stream of IndexStats snapshots
 *   Request body: adds `dbLabel` (per-repo DB) and `sshKey` credential type
 *
 * Security mitigations enforced:
 *   - SSRF: HTTPS + SSH allowed, DNS resolution checked against blocked IP ranges
 *   - Credential leakage: GIT_ASKPASS helper (token) / temp key file (SSH), never in argv
 *   - Oversized repos: background du polling + SIGKILL + GITSEMA_CLONE_MAX_BYTES
 *   - Clone timeout: GITSEMA_CLONE_TIMEOUT_MS (default 10 min)
 *   - DoS: server-wide semaphore (GITSEMA_CLONE_CONCURRENCY, default 2)
 *   - Path traversal: mkdtemp under validated GITSEMA_CLONE_DIR
 *   - Input: Zod schema, array limits, string length limits
 *   - dbLabel: alphanumeric + hyphens only, 1–64 chars
 */

import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import type { EmbeddingProvider } from '../../core/embedding/provider.js'
import { PROFILE_NAME_RE } from '../../core/embedding/profiles.js'
import type { EmbeddingProviderPair } from '../../core/embedding/profiles.js'
import type { ChunkStrategy } from '../../core/chunking/chunker.js'
import { runIndex } from '../../core/indexing/indexer.js'
import type { IndexStats } from '../../core/indexing/indexer.js'
import {
  validateCloneUrl,
  obtainClone,
  cleanupClone,
  getCloneSemaphore,
  sanitiseUrl,
} from '../../core/git/cloneRepo.js'
import { getActiveSession, getOrOpenLabeledDb, getOrOpenSessionAtPath, withDbSession } from '../../core/db/sqlite.js'
import {
  getRegistrySession,
  getRepoClonePath,
  getRepoDbPath,
  normalizeRepoUrl,
  deriveRepoId,
  findRepoByNormalizedUrl,
  getRepo,
  registerPersistedRepo,
  touchLastIndexed,
  withRepoLock,
  isPublicAutoIndexAllowed,
  getMinReindexIntervalSeconds,
  type RepoVisibility,
} from '../../core/indexing/repoRegistry.js'
import { createGrant, resolveUserRepoAccess, getRepoOrgId } from '../../core/auth/grants.js'
import { getEffectiveAllowedSet } from '../../core/admin/modelPolicy.js'
import { recordAuditEvent } from '../../core/auth/auditLog.js'
import { logger } from '../../utils/logger.js'

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const TokenCredentialsSchema = z.object({
  type: z.literal('token'),
  token: z.string().min(1).max(256),
})

const SshKeyCredentialsSchema = z.object({
  type: z.literal('sshKey'),
  /** PEM-encoded SSH private key. Max 16 KB covers all common key types. */
  key: z.string().min(1).max(16384),
})

const CredentialsSchema = z.discriminatedUnion('type', [
  TokenCredentialsSchema,
  SshKeyCredentialsSchema,
])

const IndexOptionsSchema = z.object({
  since: z.string().max(256).nullable().optional(),
  maxCommits: z.number().int().positive().nullable().optional(),
  concurrency: z.number().int().min(1).max(32).optional(),
  ext: z.array(z.string().max(32)).max(100).optional(),
  maxSize: z.string().max(32).optional(),
  exclude: z.array(z.string().max(256)).max(100).optional(),
  chunker: z.enum(['file', 'function', 'fixed']).optional(),
  windowSize: z.number().int().positive().optional(),
  overlap: z.number().int().nonnegative().optional(),
}).strict()

/** Alphanumeric + hyphens, 1–64 chars. Used as a DB filename component. */
const DbLabelSchema = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/, {
  message: 'dbLabel must be 1–64 alphanumeric characters or hyphens',
})

/** Repo IDs are derived as a 16-char hex digest of the normalized URL. */
const RepoIdSchema = z.string().regex(/^[a-f0-9]{16}$/, {
  message: 'repoId must be a 16-character hex string',
})

/** Same shape as EmbeddingProfileSchema's name field in profiles.ts. */
const ProfileNameSchema = z.string().regex(PROFILE_NAME_RE, {
  message: 'profileName must be 1-64 alphanumeric/hyphen/underscore characters',
})

const RemoteIndexBodySchema = z.object({
  repoUrl: z.string().max(2048),
  credentials: CredentialsSchema.optional(),
  cloneDepth: z.number().int().positive().nullable().optional(),
  indexOptions: IndexOptionsSchema.optional(),
  /** Optional label — routes indexing to .gitsema/<label>.db instead of the default DB. Only used when persist=false. */
  dbLabel: DbLabelSchema.optional(),
  /**
   * Persist the clone + index under GITSEMA_DATA_DIR and reuse it on
   * subsequent requests for the same repoUrl (fetch + incremental index
   * instead of a fresh clone + full index). Defaults to true.
   */
  persist: z.boolean().optional().default(true),
  /** Target a specific already-registered persisted repo explicitly. */
  repoId: RepoIdSchema.optional(),
  /**
   * Visibility to register a brand-new persisted repo with. Only honored on
   * first creation (Phase 126 / public-repo-sharing §4.1) — has no effect on
   * an already-registered repo. Defaults to 'private'.
   */
  visibility: z.enum(['private', 'public']).optional(),
  /**
   * Embedding profile to index with (Phase 128 / locked-model-set-plan.md
   * §4.1.3). Only meaningful when persist=true. Pinned forever on first
   * index of a repo — has no effect on an already-pinned repo beyond
   * validating it matches.
   */
  profileName: ProfileNameSchema.optional(),
}).strict()

// ---------------------------------------------------------------------------
// Size-string parser (mirrors CLI --max-size parsing)
// ---------------------------------------------------------------------------

function parseMaxSize(s: string): number {
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb|b)?$/i)
  if (!match) throw new Error(`Invalid max-size value: ${s}`)
  const n = parseFloat(match[1])
  const unit = (match[2] ?? 'b').toLowerCase()
  const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }
  return Math.floor(n * (multipliers[unit] ?? 1))
}

// ---------------------------------------------------------------------------
// Job registry (Phase 17 — async job API; Phase 18 — stability improvements)
// ---------------------------------------------------------------------------

type JobSubscriber = (event: JobEvent) => void

type JobEvent =
  | { type: 'progress'; stats: IndexStats }
  | { type: 'done'; stats: IndexStats }
  | { type: 'error'; error: string }

interface Job {
  id: string
  status: 'running' | 'done' | 'failed'
  stats: IndexStats | null
  error: string | null
  subscribers: JobSubscriber[]
  /** Unix timestamp (ms) when the job was created. */
  createdAt: number
  /** Unix timestamp (ms) when the job completed (done or failed). Null if still running. */
  completedAt: number | null
}

/** Serializable summary of a completed job for disk persistence. */
interface JobSummary {
  id: string
  status: 'done' | 'failed'
  stats: IndexStats | null
  error: string | null
  createdAt: number
  completedAt: number
}

const _jobs = new Map<string, Job>()

/** Remove completed jobs after this TTL to prevent unbounded memory growth. */
const JOB_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Maximum number of jobs retained in memory at any time.
 * When exceeded, completed/failed jobs are evicted LRU-first.
 * Configurable via GITSEMA_JOB_REGISTRY_MAX (default 500).
 */
const MAX_JOB_REGISTRY_SIZE = Math.max(
  1,
  parseInt(process.env['GITSEMA_JOB_REGISTRY_MAX'] ?? '500', 10) || 500,
)

/**
 * Optional path to a JSON-lines file where completed job summaries are appended.
 * When set, completed jobs are persisted and reloaded on startup for debugging.
 * Configurable via GITSEMA_JOB_PERSIST_PATH.
 */
const JOB_PERSIST_PATH = process.env['GITSEMA_JOB_PERSIST_PATH'] ?? ''

/** Cumulative count of jobs evicted from the registry due to the size cap. */
let _evictionCount = 0

/**
 * Returns a snapshot of job registry metrics for monitoring.
 */
export function getJobMetrics(): {
  total: number
  running: number
  done: number
  failed: number
  evictions: number
} {
  let running = 0
  let done = 0
  let failed = 0
  for (const job of _jobs.values()) {
    if (job.status === 'running') running++
    else if (job.status === 'done') done++
    else failed++
  }
  return { total: _jobs.size, running, done, failed, evictions: _evictionCount }
}

/**
 * Evicts jobs from the registry when at capacity.
 * Eviction order: oldest completed/failed first, then oldest running.
 * At least one slot is freed per call.
 */
function evictIfNeeded(): void {
  if (_jobs.size < MAX_JOB_REGISTRY_SIZE) return

  // Collect completed/failed jobs sorted by completedAt ascending (oldest first)
  const completed = Array.from(_jobs.values())
    .filter((j) => j.completedAt !== null)
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))

  if (completed.length > 0) {
    _jobs.delete(completed[0].id)
    _evictionCount++
    return
  }

  // Fallback: evict oldest running job by createdAt
  const running = Array.from(_jobs.values()).sort((a, b) => a.createdAt - b.createdAt)
  if (running.length > 0) {
    _jobs.delete(running[0].id)
    _evictionCount++
  }
}

/**
 * Appends a completed job summary to the persistence file (if configured).
 */
function persistJob(job: Job): void {
  if (!JOB_PERSIST_PATH) return
  const summary: JobSummary = {
    id: job.id,
    status: job.status as 'done' | 'failed',
    stats: job.stats,
    error: job.error,
    createdAt: job.createdAt,
    completedAt: job.completedAt ?? Date.now(),
  }
  try {
    appendFileSync(JOB_PERSIST_PATH, JSON.stringify(summary) + '\n', 'utf8')
  } catch (err) {
    logger.debug(`Failed to persist job ${job.id}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Loads persisted job summaries from disk on startup.
 * Only the most recent MAX_JOB_REGISTRY_SIZE / 2 entries are loaded to
 * avoid filling memory with stale history.
 */
function loadPersistedJobs(): void {
  if (!JOB_PERSIST_PATH || !existsSync(JOB_PERSIST_PATH)) return
  try {
    const lines = readFileSync(JOB_PERSIST_PATH, 'utf8').split('\n').filter(Boolean)
    const recent = lines.slice(-Math.floor(MAX_JOB_REGISTRY_SIZE / 2))
    for (const line of recent) {
      try {
        const summary = JSON.parse(line) as JobSummary
        if (!summary.id || !summary.status) continue
        const job: Job = {
          id: summary.id,
          status: summary.status,
          stats: summary.stats,
          error: summary.error,
          subscribers: [],
          createdAt: summary.createdAt,
          completedAt: summary.completedAt,
        }
        _jobs.set(job.id, job)
      } catch {
        // skip malformed lines
      }
    }
    logger.debug(`Loaded ${_jobs.size} persisted job(s) from ${JOB_PERSIST_PATH}`)
  } catch (err) {
    logger.debug(`Failed to load persisted jobs: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Load persisted jobs at module initialisation
loadPersistedJobs()

function createJob(): Job {
  evictIfNeeded()
  const job: Job = {
    id: randomUUID(),
    status: 'running',
    stats: null,
    error: null,
    subscribers: [],
    createdAt: Date.now(),
    completedAt: null,
  }
  _jobs.set(job.id, job)
  return job
}

function notifySubscribers(job: Job, event: JobEvent): void {
  for (const sub of job.subscribers) {
    try { sub(event) } catch { /* ignore subscriber errors */ }
  }
}

function scheduleJobCleanup(jobId: string): void {
  setTimeout(() => { _jobs.delete(jobId) }, JOB_TTL_MS).unref()
}

// ---------------------------------------------------------------------------
// Refresh throttle (Phase 126 / public-repo-sharing §4.4) — limits how often
// a non-owner caller can trigger a re-index of an already-registered public
// repo. Keyed by `${repoId}:${userId}` so the repo's owner (and operator
// callers, who skip the check entirely) are never throttled.
// ---------------------------------------------------------------------------

const _lastReindexTriggerAt = new Map<string, number>()

/** Returns remaining throttle seconds (0 if not throttled), and records this attempt if allowed. */
function checkAndRecordReindexThrottle(repoId: string, userId: number, cwd?: string): number {
  const key = `${repoId}:${userId}`
  const minIntervalMs = getMinReindexIntervalSeconds(cwd) * 1000
  const now = Date.now()
  const last = _lastReindexTriggerAt.get(key)
  if (last !== undefined) {
    const elapsed = now - last
    if (elapsed < minIntervalMs) {
      return Math.ceil((minIntervalMs - elapsed) / 1000)
    }
  }
  _lastReindexTriggerAt.set(key, now)
  // Once the throttle window elapses the entry is dead weight — same TTL-cleanup
  // pattern as the `_jobs` map above, sized to this call's own interval.
  setTimeout(() => { _lastReindexTriggerAt.delete(key) }, minIntervalMs).unref()
  return 0
}

// ---------------------------------------------------------------------------
// Public repo policy (Phase 126 §4.2-4.4 gate/throttle/grant; extracted as a
// named function in Phase 133 for readability — behavior unchanged).
// ---------------------------------------------------------------------------

/**
 * Applies the three public-repo access-control checks for an already-resolved
 * (or about-to-be-created) repo, in order:
 *
 *   1. First-index gate (Phase 126 §4.2): a brand-new repo being registered as
 *      public requires `auth.allowPublicAutoIndex` unless the caller is an
 *      "operator" (no req.userId — local CLI/global-key/no-auth-required).
 *   2. Refresh throttle (Phase 126 §4.4): a non-owner authenticated caller
 *      re-indexing an existing public repo is rate-limited via
 *      `checkAndRecordReindexThrottle`.
 *   3. Attach-as-reader auto-grant (Phase 126 §4.3): a non-owner authenticated
 *      caller who has no applicable grant yet on an existing public repo is
 *      automatically granted 'read' access (provenance 'auto-public').
 *
 * Returns an error descriptor (status + body + optional Retry-After header)
 * the caller should send as the HTTP response, or `null` if all checks pass
 * and the request may proceed.
 */
function applyPublicRepoPolicy(params: {
  /** Existing repo registry row, or null/undefined if this would be a brand-new repo. */
  existing: { id: string } | null | undefined
  /** Visibility/ownerUserId of the existing repo's mirrored row in the active (auth) DB, if any. */
  existingAuth: { visibility?: RepoVisibility; ownerUserId?: number | null } | null | undefined
  /** Visibility requested for a brand-new repo registration (only meaningful when `existing` is undefined). */
  requestedVisibility: RepoVisibility | undefined
  /** The authenticated caller's user id, or undefined for an operator caller. */
  userId: number | undefined
  /** better-sqlite3 handle for the active (auth) DB, used for grant lookups/creation. */
  activeRawDb: ReturnType<typeof getActiveSession>['rawDb']
}): { status: number; body: Record<string, unknown>; retryAfterHeader?: string } | null {
  const { existing, existingAuth, requestedVisibility, userId, activeRawDb } = params

  // --- First-index gate for brand-new public repos (Phase 126 §4.2) --------
  // "Operator" callers (no req.userId — local CLI/global-key/no-auth-
  // required requests) bypass the gate, mirroring the Phase 122-125
  // precedent that operator-equivalent access is a stronger trust tier
  // than any network role.
  const isOperator = userId === undefined
  if (!existing && requestedVisibility === 'public' && !isOperator && !isPublicAutoIndexAllowed()) {
    return {
      status: 403,
      body: { error: 'Registering new repos as public requires auth.allowPublicAutoIndex to be enabled' },
    }
  }

  // The throttle and auto-grant checks share this precondition: an
  // authenticated caller who is not the owner, acting on an already-
  // registered public repo.
  const isNonOwnerOnExistingPublicRepo = Boolean(
    existing && existingAuth?.visibility === 'public' && userId !== undefined && userId !== existingAuth.ownerUserId,
  )

  // --- Refresh throttle for re-indexing an existing public repo by a
  // non-owner caller (Phase 126 §4.4) ---------------------------------------
  if (isNonOwnerOnExistingPublicRepo) {
    const retryAfter = checkAndRecordReindexThrottle(existing!.id, userId!)
    if (retryAfter > 0) {
      return {
        status: 429,
        body: { error: 'Re-index triggered too recently for this repo', retryAfter },
        retryAfterHeader: String(retryAfter),
      }
    }
  }

  // --- Attach-as-reader: auto-grant read access to a non-owner caller on
  // an existing public repo they don't already have access to (Phase 126
  // §4.3 / public-repo-sharing — "auto-public" provenance) ------------------
  if (
    isNonOwnerOnExistingPublicRepo &&
    resolveUserRepoAccess(activeRawDb, userId!, existing!.id) === undefined
  ) {
    // Only issue the auto-grant when the user holds no applicable grant
    // yet — createGrant() would otherwise overwrite a pre-existing
    // higher-role (write/owner) all-branches grant with 'read'.
    createGrant(activeRawDb, {
      userId: userId!,
      repoId: existing!.id,
      role: 'read',
      grantedBy: existingAuth!.ownerUserId ?? userId!,
      source: 'auto-public',
    })
    recordAuditEvent(activeRawDb, {
      actorUserId: userId!,
      action: 'grant.create',
      target: String(userId!),
      repoId: existing!.id,
    })
  }

  return null
}

// ---------------------------------------------------------------------------
// Core job runner
// ---------------------------------------------------------------------------

/** Context for persisting a clone + index under GITSEMA_DATA_DIR (default mode). */
interface PersistentJobContext {
  repoId: string
  name: string
  url: string
  normalizedUrl: string
  clonePath: string
  dbPath: string
  /** Only meaningful on first creation — see registerPersistedRepo's ON CONFLICT note. */
  visibility: RepoVisibility
  ownerUserId: number | null
  /** Only meaningful on first creation — pinned forever (Phase 128). Null for legacy single-profile repos. */
  profileName: string | null
}

async function runIndexJob(
  job: Job,
  options: {
    repoUrl: string
    credentials: z.infer<typeof CredentialsSchema> | undefined
    cloneDepth: number | null | undefined
    indexOptions: z.infer<typeof IndexOptionsSchema>
    dbLabel: string | undefined
    persistent: PersistentJobContext | undefined
    textProvider: EmbeddingProvider
    codeProvider: EmbeddingProvider | undefined
    serverChunker: ChunkStrategy
    serverConcurrency: number
  },
): Promise<void> {
  const {
    repoUrl, credentials, cloneDepth, indexOptions,
    dbLabel, persistent, textProvider, codeProvider, serverChunker, serverConcurrency,
  } = options

  const safeUrl = sanitiseUrl(repoUrl)
  let clonePath: string | null = null
  let succeeded = false

  try {
    logger.info(
      `Starting remote index of ${safeUrl}` +
      (persistent ? ` (repo: ${persistent.repoId})` : dbLabel ? ` (db: ${dbLabel})` : ''),
    )
    const cloneResult = await obtainClone(
      persistent
        ? { repoUrl, credentials, depth: cloneDepth ?? null, mode: 'persistent', targetDir: persistent.clonePath }
        : { repoUrl, credentials, depth: cloneDepth ?? null },
    )
    clonePath = cloneResult.clonePath

    const maxBlobSize = indexOptions.maxSize ? parseMaxSize(indexOptions.maxSize) : undefined

    const indexerOptions = {
      repoPath: clonePath,
      provider: textProvider,
      codeProvider,
      concurrency: indexOptions.concurrency ?? serverConcurrency,
      since: indexOptions.since ?? undefined,
      maxCommits: indexOptions.maxCommits ?? undefined,
      maxBlobSize,
      filter: {
        ext: indexOptions.ext && indexOptions.ext.length > 0 ? indexOptions.ext : undefined,
        exclude: indexOptions.exclude && indexOptions.exclude.length > 0
          ? indexOptions.exclude
          : undefined,
      },
      chunker: (indexOptions.chunker as ChunkStrategy | undefined) ?? serverChunker,
      chunkerOptions: {
        windowSize: indexOptions.windowSize,
        overlap: indexOptions.overlap,
      },
      onProgress: (stats: IndexStats) => {
        job.stats = stats
        notifySubscribers(job, { type: 'progress', stats })
      },
    }

    let stats: IndexStats

    if (persistent) {
      // Persistent server-side repo: all indexer writes go to
      // $GITSEMA_DATA_DIR/repos/<repoId>/index.db
      const session = getOrOpenSessionAtPath(persistent.dbPath)
      stats = await withDbSession(session, () => runIndex(indexerOptions))
    } else if (dbLabel) {
      // Per-repo DB session: all indexer writes go to .gitsema/<label>.db
      const session = getOrOpenLabeledDb(dbLabel)
      stats = await withDbSession(session, () => runIndex(indexerOptions))
    } else {
      stats = await runIndex(indexerOptions)
    }

    succeeded = true
    job.status = 'done'
    job.stats = stats
    job.completedAt = Date.now()
    persistJob(job)
    notifySubscribers(job, { type: 'done', stats })

    if (persistent) {
      const registrySession = getRegistrySession()
      const repoRow = {
        id: persistent.repoId,
        name: persistent.name,
        url: persistent.url,
        normalizedUrl: persistent.normalizedUrl,
        clonePath: persistent.clonePath,
        dbPath: persistent.dbPath,
        ephemeral: false,
        visibility: persistent.visibility,
        profileName: persistent.profileName,
      }
      // registry.db's own local `users` table is unrelated to whichever DB
      // authMiddleware resolved req.userId against, so ownerUserId is
      // deliberately omitted from this write — it would otherwise violate
      // registry.db's own repos.owner_user_id FK (public-repo-sharing §4).
      // registry.db remains the source of truth for clone/index paths only.
      registerPersistedRepo(registrySession, repoRow)
      touchLastIndexed(registrySession, persistent.repoId)
      // Mirror the repo row into the active (auth) DB too — the one
      // authMiddleware resolves req.userId against, and the one
      // orgs.ts's existing repo_grants endpoints already operate on
      // (Phase 122-125) — including ownerUserId, which only this DB needs
      // for the visibility/ownership/grant logic below (Phase 126).
      registerPersistedRepo(getActiveSession(), { ...repoRow, ownerUserId: persistent.ownerUserId })
    }

    logger.info(
      `Remote index of ${safeUrl} complete: ` +
      `${stats.indexed} indexed, ${stats.skipped} skipped, ${stats.failed} failed`,
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // Sanitise message to avoid leaking credentials
    const safeMsg = msg.replace(/https?:\/\/[^@\s]+@/g, 'https://<credentials>@')
    logger.error(`Remote index of ${safeUrl} failed: ${safeMsg}`)
    job.status = 'failed'
    job.error = safeMsg
    job.completedAt = Date.now()
    persistJob(job)
    notifySubscribers(job, { type: 'error', error: safeMsg })
  } finally {
    getCloneSemaphore().release()
    scheduleJobCleanup(job.id)
    // Persistent clones are reused across requests — never delete them.
    if (clonePath && !persistent) {
      await cleanupClone(clonePath, succeeded)
    }
  }
}

/**
 * Derives a human-readable repo name from its normalized URL —
 * the last non-empty path segment (or the whole string as a fallback).
 */
function deriveRepoName(normalizedUrl: string): string {
  try {
    if (normalizedUrl.includes('://')) {
      const segments = new URL(normalizedUrl).pathname.split('/').filter(Boolean)
      return segments[segments.length - 1] || normalizedUrl
    }
    // SCP-style: git@host:owner/repo
    const segments = normalizedUrl.split(/[:/]/).filter(Boolean)
    return segments[segments.length - 1] || normalizedUrl
  } catch {
    return normalizedUrl
  }
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export interface RemoteRouterOptions {
  textProvider: EmbeddingProvider
  codeProvider?: EmbeddingProvider
  chunkerStrategy?: ChunkStrategy
  concurrency?: number
  /**
   * Named embedding profiles (Phase 128 / locked-model-set-plan.md §4.1).
   * When omitted (or empty), falls back to a synthetic single 'default'
   * profile wrapping textProvider/codeProvider — today's single-profile
   * behavior, unchanged.
   */
  profiles?: Map<string, EmbeddingProviderPair>
}

export function remoteRouter(options: RemoteRouterOptions): Router {
  const {
    textProvider,
    codeProvider,
    chunkerStrategy: serverChunker = 'file',
    concurrency: serverConcurrency = 4,
  } = options

  const profiles: Map<string, EmbeddingProviderPair> = options.profiles && options.profiles.size > 0
    ? options.profiles
    : new Map([['default', { textProvider, codeProvider }]])

  const router = Router()

  /**
   * POST /api/v1/remote/index
   *
   * Validates input, acquires the clone semaphore, and starts an async index
   * job. Returns 202 Accepted with { jobId } immediately. The caller polls
   * GET /api/v1/remote/jobs/:jobId/progress for live progress via SSE.
   */
  router.post('/index', async (req, res) => {
    // --- 1. Validate input ---------------------------------------------------
    const parsed = RemoteIndexBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues })
      return
    }

    const { repoUrl, credentials, cloneDepth, indexOptions = {}, dbLabel, persist, repoId: requestedRepoId, visibility: requestedVisibility, profileName: requestedProfileName } = parsed.data

    // --- 2. SSRF guard -------------------------------------------------------
    try {
      await validateCloneUrl(repoUrl)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(422).json({ error: msg })
      return
    }

    // --- 2b. Resolve persistent repo registration (default mode) ------------
    let persistent: PersistentJobContext | undefined
    // Both persisted and ephemeral jobs resolve providers through the same
    // multi-profile map (Phase 135) — `'default'` is always present, either
    // because the operator configured a profile named 'default' or because
    // remoteRouter() seeds the synthetic single-profile fallback under that
    // key when no `profiles` option is given.
    let resolvedProviders: EmbeddingProviderPair = profiles.get('default') ?? { textProvider, codeProvider }
    if (persist) {
      const normalizedUrl = normalizeRepoUrl(repoUrl)
      const registrySession = getRegistrySession()
      const existing = requestedRepoId
        ? getRepo(registrySession, requestedRepoId)
        : findRepoByNormalizedUrl(registrySession, normalizedUrl)

      if (requestedRepoId && !existing) {
        res.status(404).json({ error: `repoId '${requestedRepoId}' not found` })
        return
      }
      if (existing && existing.normalizedUrl && existing.normalizedUrl !== normalizedUrl) {
        res.status(409).json({ error: 'repoId does not match repoUrl' })
        return
      }

      // Scoped tokens (req.repoId set by per-repo auth) may only operate on
      // their own repo and may not register new repos.
      if (req.repoId) {
        if (existing && existing.id !== req.repoId) {
          res.status(403).json({ error: 'Token is not authorized for this repo' })
          return
        }
        if (!existing) {
          res.status(403).json({ error: 'Scoped tokens cannot register new repos' })
          return
        }
      }

      // Visibility/ownership are read from the active DB's mirrored repo row
      // (getActiveSession()), not registrySession — registry.db is
      // cwd-independent clone/index-path bookkeeping only and deliberately
      // never stores ownerUserId (its own local `users` table is unrelated
      // to whichever DB authMiddleware resolved req.userId against). The
      // mirror row is written in runIndexJob after the first successful
      // index of a repo (Phase 126 / public-repo-sharing §4).
      const existingAuth = existing ? getRepo(getActiveSession(), existing.id) : null

      // --- 2c/2d/2e. First-index gate, refresh throttle, and attach-as-reader
      // auto-grant for public repos (Phase 126 §4.2-4.4) — extracted into
      // applyPublicRepoPolicy() (Phase 133) for readability; behavior unchanged.
      const activeRawDb = getActiveSession().rawDb
      const policyError = applyPublicRepoPolicy({
        existing,
        existingAuth,
        requestedVisibility,
        userId: req.userId,
        activeRawDb,
      })
      if (policyError) {
        if (policyError.retryAfterHeader) {
          res.setHeader('Retry-After', policyError.retryAfterHeader)
        }
        res.status(policyError.status).json(policyError.body)
        return
      }

      // --- 2f. Resolve embedding profile (Phase 128 / locked-model-set-plan.md
      // §4.1.3). A repo's profile is pinned forever at first index:
      //   - existing repo + requested profile that doesn't match the pin -> 409
      //   - new repo + no profile requested + >1 profile configured -> 400
      //     (caller must disambiguate)
      //   - new repo + no profile requested + exactly 1 profile configured ->
      //     auto-select it
      //   - unknown profile name -> 400
      // Phase 129: superadmin-gated + org-narrowed enabled set (locked-model-set-plan.md
      // §5 Phase 2). `allowedProfiles` is the picker's universe — server-wide policy
      // narrowed further by the repo's org (if any), never widened past it. A repo's
      // existing org-membership only exists for already-registered repos; brand-new
      // repos (no org yet) see only the server-wide set.
      const repoOrgId = existing ? getRepoOrgId(activeRawDb, existing.id) : null
      const allowedProfiles = getEffectiveAllowedSet(activeRawDb, 'embedding', repoOrgId, Array.from(profiles.keys()))

      const pinnedProfileName = existing?.profileName ?? null
      let resolvedProfileName: string | null
      if (pinnedProfileName) {
        if (requestedProfileName && requestedProfileName !== pinnedProfileName) {
          res.status(409).json({
            error: `repo is pinned to embedding profile '${pinnedProfileName}' and cannot be reindexed with profile '${requestedProfileName}'`,
          })
          return
        }
        resolvedProfileName = pinnedProfileName
      } else if (requestedProfileName) {
        resolvedProfileName = requestedProfileName
      } else if (allowedProfiles.length === 1) {
        resolvedProfileName = allowedProfiles[0] ?? null
      } else {
        res.status(400).json({
          error: 'profileName is required: multiple embedding profiles are configured on this server',
        })
        return
      }

      if (resolvedProfileName && !profiles.has(resolvedProfileName)) {
        res.status(400).json({ error: `Unknown embedding profile '${resolvedProfileName}'` })
        return
      }
      // A pinned profile that was later disabled keeps working for its own repo
      // (PLAN.md Phase 128 deviation note) — only the *picker* (new selections)
      // is gated by the allow-list, not a repo's pre-existing pin.
      if (resolvedProfileName && !pinnedProfileName && !allowedProfiles.includes(resolvedProfileName)) {
        res.status(403).json({ error: `Embedding profile '${resolvedProfileName}' is disabled by server policy` })
        return
      }
      if (resolvedProfileName) {
        resolvedProviders = profiles.get(resolvedProfileName)!
      }

      const repoId = existing?.id ?? deriveRepoId(normalizedUrl)
      persistent = {
        repoId,
        name: existing?.name ?? deriveRepoName(normalizedUrl),
        url: repoUrl,
        normalizedUrl,
        clonePath: existing?.clonePath ?? getRepoClonePath(repoId),
        dbPath: existing?.dbPath ?? getRepoDbPath(repoId),
        visibility: existingAuth?.visibility ?? requestedVisibility ?? 'private',
        ownerUserId: existingAuth?.ownerUserId ?? req.userId ?? null,
        profileName: resolvedProfileName,
      }
    }

    // --- 3. Acquire concurrency semaphore ------------------------------------
    const semaphore = getCloneSemaphore()
    if (semaphore.available === 0) {
      res.status(429).json({
        error: 'Too many concurrent clone operations. Retry later.',
        retryAfter: 30,
      })
      res.setHeader('Retry-After', '30')
      return
    }

    await semaphore.acquire()

    // --- 4. Create job and return jobId immediately -------------------------
    const job = createJob()
    res.status(202).json({ jobId: job.id, ...(persistent ? { repoId: persistent.repoId } : {}) })

    // --- 5. Run indexing asynchronously (semaphore released inside runner) --
    const runJob = (): Promise<void> => runIndexJob(job, {
      repoUrl,
      credentials,
      cloneDepth,
      indexOptions,
      dbLabel,
      persistent,
      textProvider: resolvedProviders.textProvider,
      codeProvider: resolvedProviders.codeProvider,
      serverChunker,
      serverConcurrency,
    })

    // Serialize clone/fetch/index for the same persisted repo across requests.
    void (persistent ? withRepoLock(persistent.repoId, runJob) : runJob())
  })

  /**
   * GET /api/v1/remote/jobs/metrics
   *
   * Returns current job registry metrics: counts by status and total evictions.
   */
  router.get('/jobs/metrics', (_req, res) => {
    res.json(getJobMetrics())
  })

  /**
   * GET /api/v1/remote/jobs/:jobId/progress
   *
   * Server-Sent Events stream. Sends IndexStats snapshots as `progress` events
   * while the job is running. Sends a final `done` or `error` event on completion.
   *
   * Event format:  data: {"type":"progress"|"done"|"error", ...}\n\n
   */
  router.get('/jobs/:jobId/progress', (req, res) => {
    const job = _jobs.get(req.params['jobId'] ?? '')
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    function send(event: JobEvent): void {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    // If the job has already finished, send the final event immediately.
    if (job.status === 'done' && job.stats) {
      send({ type: 'done', stats: job.stats })
      res.end()
      return
    }
    if (job.status === 'failed') {
      send({ type: 'error', error: job.error ?? 'Unknown error' })
      res.end()
      return
    }

    // Send the latest known stats snapshot so the client isn't blank initially.
    if (job.stats) {
      send({ type: 'progress', stats: job.stats })
    }

    // Subscribe to future updates.
    const subscriber: JobSubscriber = (event) => {
      send(event)
      if (event.type === 'done' || event.type === 'error') {
        // Remove this subscriber and close the SSE response.
        const idx = job.subscribers.indexOf(subscriber)
        if (idx >= 0) job.subscribers.splice(idx, 1)
        res.end()
      }
    }
    job.subscribers.push(subscriber)

    // Clean up when the client disconnects mid-stream.
    req.on('close', () => {
      const idx = job.subscribers.indexOf(subscriber)
      if (idx >= 0) job.subscribers.splice(idx, 1)
    })
  })

  return router
}
