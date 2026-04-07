/**
 * Prometheus metrics middleware (P2 operational readiness).
 *
 * Exposes key operational metrics for the gitsema HTTP server:
 *   - http_request_duration_seconds  histogram (method, route, status_code)
 *   - gitsema_index_blobs_total      gauge (blob count in DB)
 *   - gitsema_index_embeddings_total gauge (embedding count in DB)
 *   - gitsema_embedding_errors_total counter (provider errors)
 *   - gitsema_query_cache_hits_total counter
 *   - gitsema_query_cache_misses_total counter
 *
 * Security: the /metrics endpoint is protected by the same auth middleware
 * unless GITSEMA_METRICS_PUBLIC=1 is set.
 */

import { Registry, Histogram, Gauge, Counter, collectDefaultMetrics } from 'prom-client'
import type { Request, Response, NextFunction } from 'express'
import { getCounters } from '../../utils/metricsCounters.js'

// ---------------------------------------------------------------------------
// Shared registry
// ---------------------------------------------------------------------------
export const metricsRegistry = new Registry()
metricsRegistry.setDefaultLabels({ app: 'gitsema' })
collectDefaultMetrics({ register: metricsRegistry })

// ---------------------------------------------------------------------------
// HTTP request latency
// ---------------------------------------------------------------------------
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
})

// ---------------------------------------------------------------------------
// Index size gauges
// ---------------------------------------------------------------------------
export const indexBlobsGauge = new Gauge({
  name: 'gitsema_index_blobs_total',
  help: 'Total number of unique blobs in the index',
  registers: [metricsRegistry],
})

export const indexEmbeddingsGauge = new Gauge({
  name: 'gitsema_index_embeddings_total',
  help: 'Total number of embeddings stored (whole-file)',
  registers: [metricsRegistry],
})

// ---------------------------------------------------------------------------
// Embedding error counter (synced from shared in-process counter on scrape)
// ---------------------------------------------------------------------------
export const embeddingErrorsGauge = new Gauge({
  name: 'gitsema_embedding_errors_total',
  help: 'Total number of embedding provider errors',
  registers: [metricsRegistry],
})

// ---------------------------------------------------------------------------
// Query cache gauges (synced from shared in-process counters on scrape)
// ---------------------------------------------------------------------------
export const queryCacheHitsGauge = new Gauge({
  name: 'gitsema_query_cache_hits_total',
  help: 'Total number of query embedding cache hits',
  registers: [metricsRegistry],
})

export const queryCacheMissesGauge = new Gauge({
  name: 'gitsema_query_cache_misses_total',
  help: 'Total number of query embedding cache misses',
  registers: [metricsRegistry],
})

// ---------------------------------------------------------------------------
// Request timing middleware — attach to the Express app before routes
// ---------------------------------------------------------------------------

/**
 * Normalises an Express route path for use as a Prometheus label.
 * Unknown / dynamic routes fall back to the first three path segments.
 */
function normaliseRoute(req: Request): string {
  if (req.route?.path) {
    const base = req.baseUrl ?? ''
    return `${base}${req.route.path}`
  }
  const parts = req.path.split('/').filter(Boolean)
  return '/' + parts.slice(0, 3).join('/')
}

export function requestTimingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer()
  res.on('finish', () => {
    end({
      method: req.method,
      route: normaliseRoute(req),
      status_code: String(res.statusCode),
    })
  })
  next()
}

// ---------------------------------------------------------------------------
// Gauge updaters — called on each /metrics scrape
// ---------------------------------------------------------------------------

/** Refresh index size gauges from the live DB. */
export function refreshIndexGauges(rawDb: import('better-sqlite3').Database): void {
  try {
    const { blobs } = rawDb.prepare('SELECT COUNT(*) as blobs FROM blobs').get() as {
      blobs: number
    }
    indexBlobsGauge.set(blobs)
  } catch {
    // non-fatal
  }
  try {
    const { embeddings } = rawDb
      .prepare('SELECT COUNT(*) as embeddings FROM embeddings')
      .get() as { embeddings: number }
    indexEmbeddingsGauge.set(embeddings)
  } catch {
    // non-fatal
  }
}

/** Sync the shared in-process counters into prom-client gauges. */
export function syncProcessCounters(): void {
  const c = getCounters()
  queryCacheHitsGauge.set(c.queryCacheHits)
  queryCacheMissesGauge.set(c.queryCacheMisses)
  embeddingErrorsGauge.set(c.embeddingErrors)
}
