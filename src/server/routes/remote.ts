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
import { getOrOpenLabeledDb, withDbSession } from '../../core/db/sqlite.js'
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

const RemoteIndexBodySchema = z.object({
  repoUrl: z.string().max(2048),
  credentials: CredentialsSchema.optional(),
  cloneDepth: z.number().int().positive().nullable().optional(),
  indexOptions: IndexOptionsSchema.optional(),
  /** Optional label — routes indexing to .gitsema/<label>.db instead of the default DB. */
  dbLabel: DbLabelSchema.optional(),
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
// Core job runner
// ---------------------------------------------------------------------------

async function runIndexJob(
  job: Job,
  options: {
    repoUrl: string
    credentials: z.infer<typeof CredentialsSchema> | undefined
    cloneDepth: number | null | undefined
    indexOptions: z.infer<typeof IndexOptionsSchema>
    dbLabel: string | undefined
    textProvider: EmbeddingProvider
    codeProvider: EmbeddingProvider | undefined
    serverChunker: ChunkStrategy
    serverConcurrency: number
  },
): Promise<void> {
  const {
    repoUrl, credentials, cloneDepth, indexOptions,
    dbLabel, textProvider, codeProvider, serverChunker, serverConcurrency,
  } = options

  const safeUrl = sanitiseUrl(repoUrl)
  let clonePath: string | null = null
  let succeeded = false

  try {
    logger.info(`Starting remote index of ${safeUrl}${dbLabel ? ` (db: ${dbLabel})` : ''}`)
    const cloneResult = await obtainClone({
      repoUrl,
      credentials,
      depth: cloneDepth ?? null,
    })
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

    if (dbLabel) {
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
    if (clonePath) {
      await cleanupClone(clonePath, succeeded)
    }
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
}

export function remoteRouter(options: RemoteRouterOptions): Router {
  const {
    textProvider,
    codeProvider,
    chunkerStrategy: serverChunker = 'file',
    concurrency: serverConcurrency = 4,
  } = options

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

    const { repoUrl, credentials, cloneDepth, indexOptions = {}, dbLabel } = parsed.data

    // --- 2. SSRF guard -------------------------------------------------------
    try {
      await validateCloneUrl(repoUrl)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(422).json({ error: msg })
      return
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
    res.status(202).json({ jobId: job.id })

    // --- 5. Run indexing asynchronously (semaphore released inside runner) --
    void runIndexJob(job, {
      repoUrl,
      credentials,
      cloneDepth,
      indexOptions,
      dbLabel,
      textProvider,
      codeProvider,
      serverChunker,
      serverConcurrency,
    })
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
