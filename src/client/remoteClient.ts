/**
 * HTTP client for the gitsema remote server (Phase 15 + Phase 17).
 *
 * All methods read GITSEMA_REMOTE (base URL) and GITSEMA_REMOTE_KEY (optional
 * Bearer token) from the environment.  They throw on non-2xx responses so
 * callers can handle errors uniformly.
 *
 * Phase 17 additions:
 *   - remoteIndexRepo now returns { jobId } via 202 Accepted
 *   - streamJobProgress streams SSE progress events for a running job
 */

import type { SearchResult } from '../core/models/types.js'
import type { IndexStats } from '../core/indexing/indexer.js'

function getBaseUrl(): string {
  const url = process.env.GITSEMA_REMOTE
  if (!url) throw new Error('GITSEMA_REMOTE is not set')
  return url.replace(/\/$/, '')
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = process.env.GITSEMA_REMOTE_KEY
  if (key) headers['Authorization'] = `Bearer ${key}`
  return headers
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const url = `${getBaseUrl()}/api/v1${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Remote server error ${res.status} at ${path}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function requestGet<T>(path: string): Promise<T> {
  const url = `${getBaseUrl()}/api/v1${path}`
  const res = await fetch(url, { method: 'GET', headers: buildHeaders() })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Remote server error ${res.status} at ${path}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Blob operations
// ---------------------------------------------------------------------------

/**
 * Returns the subset of hashes that the server does NOT already have.
 * Batches automatically at 500 per request.
 */
export async function checkBlobs(hashes: string[]): Promise<Set<string>> {
  const BATCH = 500
  const missing = new Set<string>()
  for (let i = 0; i < hashes.length; i += BATCH) {
    const batch = hashes.slice(i, i + BATCH)
    const result = await request<{ missing: string[] }>('/blobs/check', { hashes: batch })
    for (const h of result.missing) missing.add(h)
  }
  return missing
}

export interface RemoteBlobPayload {
  blobHash: string
  path: string
  size: number
  content: string
  fileType?: 'code' | 'text' | 'other'
}

export interface BlobUploadResult {
  indexed: number
  skipped: number
  failed: number
}

/**
 * Sends a batch of blobs to the server for embedding and storage.
 * Batches automatically at 100 per request.
 */
export async function uploadBlobs(payloads: RemoteBlobPayload[]): Promise<BlobUploadResult> {
  const BATCH = 100
  const total: BlobUploadResult = { indexed: 0, skipped: 0, failed: 0 }
  for (let i = 0; i < payloads.length; i += BATCH) {
    const batch = payloads.slice(i, i + BATCH)
    const result = await request<BlobUploadResult>('/blobs', batch)
    total.indexed += result.indexed
    total.skipped += result.skipped
    total.failed += result.failed
  }
  return total
}

// ---------------------------------------------------------------------------
// Commit operations
// ---------------------------------------------------------------------------

export interface RemoteCommitPayload {
  commitHash: string
  timestamp: number
  message: string
  blobHashes: string[]
}

/** Sends commit metadata and blob-commit associations to the server. */
export async function uploadCommits(commits: RemoteCommitPayload[]): Promise<number> {
  const BATCH = 500
  let stored = 0
  for (let i = 0; i < commits.length; i += BATCH) {
    const batch = commits.slice(i, i + BATCH)
    const result = await request<{ stored: number }>('/commits', batch)
    stored += result.stored
  }
  return stored
}

/** Marks a commit as fully indexed (for incremental resume). */
export async function markCommitIndexed(commitHash: string): Promise<void> {
  await request('/commits/mark-indexed', { commitHash })
}

// ---------------------------------------------------------------------------
// Search operations
// ---------------------------------------------------------------------------

export interface RemoteSearchOptions {
  top?: number
  recent?: boolean
  alpha?: number
  before?: string
  after?: string
  weightVector?: number
  weightRecency?: number
  weightPath?: number
  group?: 'file' | 'module' | 'commit'
  chunks?: boolean
  hybrid?: boolean
  bm25Weight?: number
}

/** Runs a semantic search on the server and returns raw SearchResult objects. */
export async function remoteSearch(query: string, options: RemoteSearchOptions = {}): Promise<SearchResult[]> {
  return request<SearchResult[]>('/search', { query, ...options })
}

/** Returns first-seen results sorted by earliest date. */
export async function remoteFirstSeen(query: string, top: number = 10): Promise<SearchResult[]> {
  return request<SearchResult[]>('/search/first-seen', { query, top })
}

// ---------------------------------------------------------------------------
// Evolution operations
// ---------------------------------------------------------------------------

/** Returns the file evolution timeline as structured JSON. */
export async function remoteFileEvolution(
  path: string,
  options: { threshold?: number; includeContent?: boolean } = {},
): Promise<unknown> {
  return request('/evolution/file', { path, ...options })
}

/** Returns the concept evolution timeline as structured JSON. */
export async function remoteConceptEvolution(
  query: string,
  options: { top?: number; threshold?: number; includeContent?: boolean } = {},
): Promise<unknown> {
  return request('/evolution/concept', { query, ...options })
}

// ---------------------------------------------------------------------------
// Remote repository indexing (Phase 16 + Phase 17)
// ---------------------------------------------------------------------------

export interface RemoteIndexCredentials {
  type: 'token'
  token: string
}

export interface RemoteIndexSshCredentials {
  type: 'sshKey'
  key: string
}

export interface RemoteIndexOptions {
  since?: string | null
  maxCommits?: number | null
  concurrency?: number
  ext?: string[]
  maxSize?: string
  exclude?: string[]
  chunker?: 'file' | 'function' | 'fixed'
  windowSize?: number
  overlap?: number
}

export interface RemoteIndexRequest {
  repoUrl: string
  credentials?: RemoteIndexCredentials | RemoteIndexSshCredentials
  cloneDepth?: number | null
  indexOptions?: RemoteIndexOptions
  /** Routes indexing to .gitsema/<dbLabel>.db instead of the default DB. */
  dbLabel?: string
}

export interface RemoteIndexStats {
  seen: number
  indexed: number
  skipped: number
  oversized: number
  filtered: number
  failed: number
  embedFailed: number
  otherFailed: number
  fbFunction: number
  fbFixed: number
  queued: number
  elapsed: number
  commits: number
  blobCommits: number
  chunks: number
}

/** Response from POST /remote/index (Phase 17 async job API). */
export interface RemoteIndexJobResponse {
  jobId: string
}

/**
 * Starts a remote index job and returns the job ID immediately.
 * Use `streamJobProgress` to receive live progress and the final stats.
 */
export async function startRemoteIndexJob(req: RemoteIndexRequest): Promise<RemoteIndexJobResponse> {
  const url = `${getBaseUrl()}/api/v1/remote/index`
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(req),
  })
  if (res.status !== 202) {
    const text = await res.text().catch(() => '')
    throw new Error(`Remote server error ${res.status} at /remote/index: ${text}`)
  }
  return res.json() as Promise<RemoteIndexJobResponse>
}

/**
 * Streams Server-Sent Events for a running remote index job.
 *
 * Calls `onProgress` for each `progress` event.
 * Resolves with the final IndexStats when the `done` event arrives.
 * Rejects with an error when the `error` event arrives or the stream closes unexpectedly.
 */
export async function streamJobProgress(
  jobId: string,
  onProgress: (stats: IndexStats) => void,
): Promise<RemoteIndexStats> {
  const url = `${getBaseUrl()}/api/v1/remote/jobs/${jobId}/progress`
  const res = await fetch(url, {
    method: 'GET',
    headers: { ...buildHeaders(), Accept: 'text/event-stream' },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Remote server error ${res.status} at /remote/jobs/${jobId}/progress: ${text}`)
  }

  if (!res.body) {
    throw new Error('No response body from SSE endpoint')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // SSE lines are separated by \n; events are separated by \n\n.
    // We process complete lines and keep the incomplete tail in the buffer.
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue

      let event: { type: string; stats?: IndexStats; error?: string }
      try {
        event = JSON.parse(line.slice(6)) as typeof event
      } catch {
        continue // malformed line; skip
      }

      if (event.type === 'progress' && event.stats) {
        onProgress(event.stats)
      } else if (event.type === 'done' && event.stats) {
        return event.stats as RemoteIndexStats
      } else if (event.type === 'error') {
        throw new Error(event.error ?? 'Remote index job failed')
      }
    }
  }

  throw new Error('SSE stream closed without a final done/error event')
}

/**
 * Convenience wrapper: starts a remote index job and streams progress until
 * completion. Calls `onProgress` for each snapshot; returns final stats.
 */
export async function remoteIndexRepo(
  req: RemoteIndexRequest,
  onProgress?: (stats: IndexStats) => void,
): Promise<RemoteIndexStats> {
  const { jobId } = await startRemoteIndexJob(req)
  return streamJobProgress(jobId, onProgress ?? (() => { /* no-op */ }))
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface RemoteStatus {
  blobs: number
  embeddings: number
  chunks: number
  commits: number
  dbPath: string
  model: string
  codeModel?: string
}

export async function remoteStatus(): Promise<RemoteStatus> {
  return requestGet<RemoteStatus>('/status')
}
