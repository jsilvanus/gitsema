/**
 * Remote repository indexing route (Phase 16).
 *
 * POST /api/v1/remote/index
 *
 * Accepts an HTTPS Git URL + optional credentials, clones the repository into
 * a RAM-backed temp directory, runs the full indexing pipeline, and returns
 * IndexStats.  The clone is cleaned up according to GITSEMA_CLONE_KEEP.
 *
 * Security mitigations enforced:
 *   - SSRF: HTTPS-only, DNS resolution checked against blocked IP ranges
 *   - Credential leakage: spawn argv array (no shell), sanitised error messages
 *   - Oversized repos: background du polling + SIGKILL + GITSEMA_CLONE_MAX_BYTES
 *   - Clone timeout: GITSEMA_CLONE_TIMEOUT_MS (default 10 min)
 *   - DoS: server-wide semaphore (GITSEMA_CLONE_CONCURRENCY, default 2)
 *   - Path traversal: mkdtemp under validated GITSEMA_CLONE_DIR
 *   - Input: Zod schema, array limits, string length limits
 */

import { Router } from 'express'
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
import { logger } from '../../utils/logger.js'

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CredentialsSchema = z.object({
  type: z.literal('token'),
  token: z.string().min(1).max(256),
})

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

const RemoteIndexBodySchema = z.object({
  repoUrl: z.string().max(2048),
  credentials: CredentialsSchema.optional(),
  cloneDepth: z.number().int().positive().nullable().optional(),
  indexOptions: IndexOptionsSchema.optional(),
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
   * Body: RemoteIndexBody (see schema above)
   * Response: IndexStats JSON
   */
  router.post('/index', async (req, res) => {
    // --- 1. Validate input ---------------------------------------------------
    const parsed = RemoteIndexBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues })
      return
    }

    const { repoUrl, credentials, cloneDepth, indexOptions = {} } = parsed.data

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

    const safeUrl = sanitiseUrl(repoUrl)
    let clonePath: string | null = null
    let succeeded = false

    try {
      // --- 4. Clone -----------------------------------------------------------
      logger.info(`Starting remote index of ${safeUrl}`)
      const cloneResult = await obtainClone({
        repoUrl,
        credentials,
        depth: cloneDepth ?? null,
      })
      clonePath = cloneResult.clonePath

      // --- 5. Build index options --------------------------------------------
      const maxBlobSize = indexOptions.maxSize
        ? parseMaxSize(indexOptions.maxSize)
        : undefined

      const stats: IndexStats = await runIndex({
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
      })

      succeeded = true
      logger.info(
        `Remote index of ${safeUrl} complete: ` +
        `${stats.indexed} indexed, ${stats.skipped} skipped, ${stats.failed} failed`,
      )

      res.status(200).json(stats)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // Sanitise message to avoid leaking credentials
      const safeMsg = msg.replace(/https?:\/\/[^@\s]+@/g, 'https://<credentials>@')
      logger.error(`Remote index of ${safeUrl} failed: ${safeMsg}`)
      res.status(500).json({ error: safeMsg })
    } finally {
      semaphore.release()
      if (clonePath) {
        await cleanupClone(clonePath, succeeded)
      }
    }
  })

  return router
}
