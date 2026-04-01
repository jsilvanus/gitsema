/**
 * `gitsema remote-index <repoUrl>` — Phase 16.
 *
 * Thin wrapper that calls POST /api/v1/remote/index on the configured
 * gitsema server (GITSEMA_REMOTE or --remote <url>).
 */

import { remoteIndexRepo } from '../../client/remoteClient.js'
import type { RemoteIndexOptions } from '../../client/remoteClient.js'

export interface RemoteIndexCommandOptions {
  remote?: string
  token?: string
  depth?: string
  since?: string
  maxCommits?: string
  concurrency?: string
  ext?: string
  maxSize?: string
  exclude?: string
  chunker?: string
  windowSize?: string
  overlap?: string
}

export async function remoteIndexCommand(
  repoUrl: string,
  options: RemoteIndexCommandOptions,
): Promise<void> {
  // --remote overrides GITSEMA_REMOTE
  if (options.remote) process.env.GITSEMA_REMOTE = options.remote

  if (!process.env.GITSEMA_REMOTE) {
    console.error(
      'Error: --remote <url> or GITSEMA_REMOTE environment variable is required for remote-index',
    )
    process.exit(1)
  }

  // Validate URL scheme client-side before making the request
  let parsedUrl: URL
  try {
    parsedUrl = new URL(repoUrl)
  } catch {
    console.error(`Error: Invalid URL: ${repoUrl}`)
    process.exit(1)
  }

  if (parsedUrl.protocol !== 'https:') {
    console.error(`Error: Only https:// URLs are supported (got ${parsedUrl.protocol})`)
    process.exit(1)
  }

  const cloneDepth = options.depth !== undefined ? parseInt(options.depth, 10) : undefined
  if (cloneDepth !== undefined && (isNaN(cloneDepth) || cloneDepth < 1)) {
    console.error('Error: --depth must be a positive integer')
    process.exit(1)
  }

  const concurrency = options.concurrency !== undefined
    ? parseInt(options.concurrency, 10)
    : undefined
  if (concurrency !== undefined && (isNaN(concurrency) || concurrency < 1)) {
    console.error('Error: --concurrency must be a positive integer')
    process.exit(1)
  }

  const maxCommits = options.maxCommits !== undefined
    ? parseInt(options.maxCommits, 10)
    : undefined
  if (maxCommits !== undefined && (isNaN(maxCommits) || maxCommits < 1)) {
    console.error('Error: --max-commits must be a positive integer')
    process.exit(1)
  }

  const indexOptions: RemoteIndexOptions = {}
  if (options.since !== undefined) indexOptions.since = options.since
  if (maxCommits !== undefined) indexOptions.maxCommits = maxCommits
  if (concurrency !== undefined) indexOptions.concurrency = concurrency
  if (options.ext !== undefined) {
    indexOptions.ext = options.ext.split(',').map((e) => e.trim()).filter(Boolean)
  }
  if (options.maxSize !== undefined) indexOptions.maxSize = options.maxSize
  if (options.exclude !== undefined) {
    indexOptions.exclude = options.exclude.split(',').map((e) => e.trim()).filter(Boolean)
  }
  if (options.chunker !== undefined) {
    if (options.chunker !== 'file' && options.chunker !== 'function' && options.chunker !== 'fixed') {
      console.error('Error: --chunker must be one of: file, function, fixed')
      process.exit(1)
    }
    indexOptions.chunker = options.chunker as 'file' | 'function' | 'fixed'
  }
  if (options.windowSize !== undefined) {
    const n = parseInt(options.windowSize, 10)
    if (isNaN(n) || n < 1) {
      console.error('Error: --window-size must be a positive integer')
      process.exit(1)
    }
    indexOptions.windowSize = n
  }
  if (options.overlap !== undefined) {
    const n = parseInt(options.overlap, 10)
    if (isNaN(n) || n < 0) {
      console.error('Error: --overlap must be a non-negative integer')
      process.exit(1)
    }
    indexOptions.overlap = n
  }

  console.log(`Requesting remote index of ${repoUrl} …`)

  try {
    const stats = await remoteIndexRepo({
      repoUrl,
      credentials: options.token ? { type: 'token', token: options.token } : undefined,
      cloneDepth: cloneDepth ?? null,
      indexOptions,
    })

    console.log(`\nRemote index complete:`)
    console.log(`  Seen:      ${stats.seen}`)
    console.log(`  Indexed:   ${stats.indexed}`)
    console.log(`  Skipped:   ${stats.skipped}`)
    console.log(`  Oversized: ${stats.oversized}`)
    console.log(`  Filtered:  ${stats.filtered}`)
    console.log(`  Failed:    ${stats.failed}`)
    if (stats.fbFunction > 0) console.log(`  Fallback (function): ${stats.fbFunction}`)
    if (stats.fbFixed > 0) console.log(`  Fallback (fixed):    ${stats.fbFixed}`)
    console.log(`  Commits:   ${stats.commits}`)
    console.log(`  Elapsed:   ${(stats.elapsed / 1000).toFixed(1)}s`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${msg}`)
    process.exit(1)
  }
}
