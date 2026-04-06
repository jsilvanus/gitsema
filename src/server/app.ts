/**
 * gitsema HTTP server (Phase 16)
 *
 * Express application factory.  Registers all routes and auth middleware.
 * All embedding and storage happens here; the CLI client only sends raw blobs.
 *
 * Routes (all under /api/v1/):
 *   GET  /status
 *   POST /blobs/check
 *   POST /blobs
 *   POST /commits
 *   POST /commits/mark-indexed
 *   POST /search
 *   POST /search/first-seen
 *   POST /evolution/file
 *   POST /evolution/concept
 *   POST /remote/index        (Phase 16 — server-managed clone + index)
 *   POST /analysis/clusters   (Phase 34 — analysis commands)
 *   POST /analysis/change-points
 *   POST /analysis/author
 *   POST /analysis/impact
 *   POST /analysis/semantic-diff
 *   POST /analysis/semantic-blame
 *   POST /analysis/dead-concepts
 *   POST /analysis/merge-audit
 *   POST /analysis/merge-preview
 *   POST /analysis/branch-summary
 *   POST /analysis/security-scan  (Phase 43)
 *   POST /analysis/health         (Phase 44)
 *   POST /analysis/debt           (Phase 45)
 */

import express from 'express'
import type { Express } from 'express'
import type { EmbeddingProvider } from '../core/embedding/provider.js'
import type { ChunkStrategy } from '../core/chunking/chunker.js'
import { authMiddleware } from './middleware/auth.js'
import { statusRouter } from './routes/status.js'
import { blobsRouter } from './routes/blobs.js'
import { commitsRouter } from './routes/commits.js'
import { searchRouter } from './routes/search.js'
import { evolutionRouter } from './routes/evolution.js'
import { remoteRouter } from './routes/remote.js'
import { analysisRouter } from './routes/analysis.js'

export interface AppOptions {
  textProvider: EmbeddingProvider
  codeProvider?: EmbeddingProvider
  chunkerStrategy?: ChunkStrategy
  concurrency?: number
}

export function createApp(options: AppOptions): Express {
  const {
    textProvider,
    codeProvider,
    chunkerStrategy = 'file',
    concurrency = 4,
  } = options

  const app = express()
  app.use(express.json({ limit: '50mb' }))

  // Optional Bearer-token auth on all routes
  app.use(authMiddleware)

  const base = '/api/v1'

  app.use(`${base}/status`, statusRouter())

  app.use(
    `${base}/blobs`,
    blobsRouter({ textProvider, codeProvider, chunkerStrategy, concurrency }),
  )

  app.use(`${base}/commits`, commitsRouter())

  app.use(`${base}/search`, searchRouter({ textProvider, codeProvider }))

  app.use(`${base}/evolution`, evolutionRouter({ textProvider }))

  app.use(
    `${base}/remote`,
    remoteRouter({ textProvider, codeProvider, chunkerStrategy, concurrency }),
  )

  app.use(`${base}/analysis`, analysisRouter({ textProvider }))

  return app
}
