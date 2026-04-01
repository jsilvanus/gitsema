/**
 * HTTP client for the gitsema remote server (Phase 15).
 *
 * All methods read GITSEMA_REMOTE (base URL) and GITSEMA_REMOTE_KEY (optional
 * Bearer token) from the environment.  They throw on non-2xx responses so
 * callers can handle errors uniformly.
 */

import type { SearchResult } from '../core/models/types.js'

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
