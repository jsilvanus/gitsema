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
import { watchRouter } from './routes/watch.js'
import { projectionsRouter } from './routes/projections.js'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AppOptions {
  textProvider: EmbeddingProvider
  codeProvider?: EmbeddingProvider
  chunkerStrategy?: ChunkStrategy
  concurrency?: number
  /** When true, serve the embedding space explorer web UI at /ui */
  ui?: boolean
}

export function createApp(options: AppOptions): Express {
  const {
    textProvider,
    codeProvider,
    chunkerStrategy = 'file',
    concurrency = 4,
    ui = false,
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

  app.use(`${base}/watch`, watchRouter({ textProvider }))

  app.use(`${base}/projections`, projectionsRouter())

  // Phase 64: Capabilities manifest — machine-readable list of server capabilities
  app.get(`${base}/capabilities`, (_req, res) => {
    res.json({
      version: '0.65.0',
      features: [
        'semantic_search',
        'first_seen',
        'file_evolution',
        'concept_evolution',
        'change_points',
        'semantic_diff',
        'semantic_blame',
        'impact',
        'clusters',
        'merge_audit',
        'merge_preview',
        'branch_summary',
        'dead_concepts',
        'security_scan',
        'health_timeline',
        'debt_score',
        'experts',
        'multi_repo_search',
        'hybrid_search',
        'early_cut',
        'projections',
        'watch',
      ],
      providers: {
        text: textProvider.model,
        code: codeProvider ? codeProvider.model : textProvider.model,
      },
      chunker: chunkerStrategy,
    })
  })

  // Phase 55: Serve the embedding space explorer web UI when --ui is set
  if (ui) {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const uiHtmlPath = join(__dirname, '../../src/client/index.html')
    // Try src/ path first (dev), then dist/client/
    const altPath = join(__dirname, '../client/index.html')
    const htmlPath = existsSync(uiHtmlPath) ? uiHtmlPath : altPath
    app.get('/ui', (_req, res) => {
      if (existsSync(htmlPath)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.send(readFileSync(htmlPath, 'utf8'))
      } else {
        res.status(404).send('Web UI not found. Ensure src/client/index.html exists.')
      }
    })
    app.get('/', (_req, res) => res.redirect('/ui'))
  }

  return app
}
