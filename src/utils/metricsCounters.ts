/**
 * Lightweight in-process metric counters shared across core and server.
 *
 * These counters are simple integers maintained in-process.  The Prometheus
 * metrics middleware reads them on each /metrics scrape and converts them to
 * prom-client Gauge/Counter values.
 *
 * Design rationale: keeping the counters here (rather than importing
 * prom-client directly in core modules) avoids pulling the HTTP server
 * dependency into the core library, which would break the CLI standalone mode.
 */

export interface MetricsCounters {
  queryCacheHits: number
  queryCacheMisses: number
  embeddingErrors: number
}

const counters: MetricsCounters = {
  queryCacheHits: 0,
  queryCacheMisses: 0,
  embeddingErrors: 0,
}

export function incQueryCacheHit(): void {
  counters.queryCacheHits++
}

export function incQueryCacheMiss(): void {
  counters.queryCacheMisses++
}

export function incEmbeddingError(): void {
  counters.embeddingErrors++
}

/** Returns a snapshot of all counters (not reset). */
export function getCounters(): Readonly<MetricsCounters> {
  return { ...counters }
}
