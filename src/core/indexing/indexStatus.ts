/**
 * indexStatus.ts — compute the coverage report shown by `gitsema index`.
 *
 * This is read-only: it never writes to the database or Git objects.
 * The report includes:
 *  - Git-reachable blob count (true 100% denominator)
 *  - DB blob count (what gitsema has seen)
 *  - Per-embed-config coverage at file / chunk / symbol / module level
 */

import { execSync } from 'node:child_process'
import type Database from 'better-sqlite3'

export interface EmbedConfigCoverage {
  /** Unique config hash from embed_config table. */
  configHash: string
  /** Embedding provider (e.g. "ollama", "http"). */
  provider: string
  /** Model name (e.g. "nomic-embed-text"). */
  model: string
  /** Code model name if different from text model. */
  codeModel?: string
  /** Embedding vector dimensions. */
  dimensions: number
  /** Chunker strategy used. */
  chunker: string
  /** Window size (fixed chunker). */
  windowSize?: number
  /** Overlap (fixed chunker). */
  overlap?: number
  /** When this config was first used. */
  createdAt: number

  // Coverage counts
  /** Distinct Git blobs embedded at file level for this config. */
  fileBlobsEmbedded: number
  /** File-level coverage as a fraction of `gitReachableBlobs` (0–1). */
  fileCoverage: number
  /** Total chunk embeddings stored for this model. */
  chunksEmbedded: number
  /** Total symbol embeddings stored for this model. */
  symbolsEmbedded: number
  /** Total module embeddings stored for this model. */
  modulesEmbedded: number
}

export interface IndexStatus {
  /** Absolute filesystem path to the SQLite database. */
  dbPath: string
  /** Current schema version. */
  schemaVersion: number
  /** Number of unique Git blob OIDs reachable from all refs (true denominator). */
  gitReachableBlobs: number
  /** Error message when the Git count could not be computed (e.g. not a git repo). */
  gitCountError?: string
  /** Number of unique blob rows stored in the gitsema DB. */
  dbBlobs: number
  /** HEAD commit hash, or undefined if repo has no commits. */
  headCommit?: string
  /** Whether HEAD is fully indexed (all blobs reachable from HEAD have embeddings). */
  headIndexed?: boolean
  /** Coverage per embed config. */
  configs: EmbedConfigCoverage[]
}

/**
 * Count unique Git blob OIDs reachable from all refs.
 * Runs `git rev-list --all --objects --filter=object:type=blob` which emits
 * one line per blob OID. The count is the number of unique OIDs.
 *
 * Returns -1 on error (not a git repo, etc.) and sets `error`.
 */
export function countGitReachableBlobs(repoPath: string): { count: number; error?: string } {
  try {
    // `git rev-list --all --objects --filter=object:type=blob` emits one line per blob OID.
    // The `--filter` argument restricts output to blobs only (no tree or commit objects).
    const out = execSync(
      'git rev-list --all --objects --filter=object:type=blob',
      { cwd: repoPath, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    // Each line is: <oid> [<path>]  — we just count unique OIDs.
    const oids = new Set<string>()
    for (const line of out.split('\n')) {
      const oid = line.trim().split(' ')[0]
      if (oid && oid.length >= 40) oids.add(oid)
    }
    return { count: oids.size }
  } catch (err) {
    return { count: 0, error: err instanceof Error ? err.message.split('\n')[0] : String(err) }
  }
}

/**
 * Compute the full index status report.
 *
 * @param rawDb  A better-sqlite3 database handle opened against the gitsema DB.
 * @param dbPath Filesystem path to the DB file (for display).
 * @param repoPath Path to the Git repository root (used to count blobs).
 */
export function computeIndexStatus(
  rawDb: InstanceType<typeof Database>,
  dbPath: string,
  repoPath: string = '.',
): IndexStatus {
  // Schema version
  const schemaRow = rawDb.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined
  const schemaVersion = schemaRow ? parseInt(schemaRow.value, 10) : 0

  // Git-reachable blob count
  const { count: gitReachableBlobs, error: gitCountError } = countGitReachableBlobs(repoPath)

  // DB blob count
  const dbBlobsRow = rawDb.prepare('SELECT COUNT(*) AS c FROM blobs').get() as { c: number }
  const dbBlobs = dbBlobsRow?.c ?? 0

  // HEAD commit
  let headCommit: string | undefined
  try {
    headCommit = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    headCommit = undefined
  }

  // Load embed configs
  const configTableExists = (rawDb.prepare(
    `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='embed_config'`,
  ).get() as { c: number })?.c > 0

  const rawConfigs: Array<{
    config_hash: string; provider: string; model: string; code_model: string | null
    dimensions: number; chunker: string; window_size: number | null; overlap: number | null
    created_at: number
  }> = configTableExists
    ? (rawDb.prepare(`SELECT * FROM embed_config ORDER BY created_at ASC`).all() as any)
    : []

  // Per-config coverage
  const configs: EmbedConfigCoverage[] = rawConfigs.map((c) => {
    // File-level blobs: count distinct blob_hash in embeddings matching this model
    const fileBlobsRow = rawDb
      .prepare('SELECT COUNT(DISTINCT blob_hash) AS n FROM embeddings WHERE model = ?')
      .get(c.model) as { n: number }
    const fileBlobsEmbedded = fileBlobsRow?.n ?? 0

    // Chunk embeddings: count distinct chunk_id in chunk_embeddings for this model
    const chunksRow = rawDb
      .prepare('SELECT COUNT(*) AS n FROM chunk_embeddings WHERE model = ?')
      .get(c.model) as { n: number }
    const chunksEmbedded = chunksRow?.n ?? 0

    // Symbol embeddings
    const symbolsRow = (() => {
      try {
        return rawDb
          .prepare('SELECT COUNT(*) AS n FROM symbol_embeddings WHERE model = ?')
          .get(c.model) as { n: number }
      } catch { return { n: 0 } }
    })()
    const symbolsEmbedded = symbolsRow?.n ?? 0

    // Module embeddings
    const modulesRow = (() => {
      try {
        return rawDb
          .prepare('SELECT COUNT(*) AS n FROM module_embeddings WHERE model = ?')
          .get(c.model) as { n: number }
      } catch { return { n: 0 } }
    })()
    const modulesEmbedded = modulesRow?.n ?? 0

    const fileCoverage =
      gitReachableBlobs > 0 ? Math.min(1, fileBlobsEmbedded / gitReachableBlobs) : 0

    return {
      configHash: c.config_hash,
      provider: c.provider,
      model: c.model,
      codeModel: c.code_model ?? undefined,
      dimensions: c.dimensions,
      chunker: c.chunker,
      windowSize: c.window_size ?? undefined,
      overlap: c.overlap ?? undefined,
      createdAt: c.created_at,
      fileBlobsEmbedded,
      fileCoverage,
      chunksEmbedded,
      symbolsEmbedded,
      modulesEmbedded,
    }
  })

  // If no embed_config rows exist but embeddings do, synthesize coverage from
  // the embeddings table itself (for older indexes before provenance tracking).
  if (configs.length === 0) {
    const modelRows = rawDb
      .prepare('SELECT DISTINCT model FROM embeddings')
      .all() as Array<{ model: string }>
    for (const { model } of modelRows) {
      const fileBlobsRow = rawDb
        .prepare('SELECT COUNT(DISTINCT blob_hash) AS n FROM embeddings WHERE model = ?')
        .get(model) as { n: number }
      const fileBlobsEmbedded = fileBlobsRow?.n ?? 0
      const fileCoverage = gitReachableBlobs > 0 ? Math.min(1, fileBlobsEmbedded / gitReachableBlobs) : 0

      const chunksRow = rawDb
        .prepare('SELECT COUNT(*) AS n FROM chunk_embeddings WHERE model = ?')
        .get(model) as { n: number }
      const chunksEmbedded = chunksRow?.n ?? 0

      configs.push({
        configHash: '',
        provider: '(unknown)',
        model,
        dimensions: 0,
        chunker: '(unknown)',
        createdAt: 0,
        fileBlobsEmbedded,
        fileCoverage,
        chunksEmbedded,
        symbolsEmbedded: 0,
        modulesEmbedded: 0,
      })
    }
  }

  return {
    dbPath,
    schemaVersion,
    gitReachableBlobs,
    gitCountError,
    dbBlobs,
    headCommit,
    configs,
  }
}

/**
 * Format the index status as a human-readable CLI output string.
 */
export function formatIndexStatus(status: IndexStatus): string {
  const lines: string[] = []

  lines.push(`DB:           ${status.dbPath}`)
  lines.push(`Schema v:     ${status.schemaVersion}`)
  if (status.headCommit) {
    lines.push(`HEAD:         ${status.headCommit.slice(0, 12)}`)
  }
  lines.push('')

  if (status.gitCountError) {
    lines.push(`Git blobs:    (error counting blobs: ${status.gitCountError})`)
  } else {
    lines.push(`Git blobs:    ${status.gitReachableBlobs.toLocaleString()}  (unique blobs reachable from all refs — 100% denominator)`)
  }
  lines.push(`DB blobs:     ${status.dbBlobs.toLocaleString()}  (blobs seen by gitsema)`)
  lines.push('')

  if (status.configs.length === 0) {
    lines.push('No embeddings found. Run `gitsema index start` to begin indexing.')
    return lines.join('\n')
  }

  lines.push('Embeddings coverage:')
  for (const cfg of status.configs) {
    const pct = (cfg.fileCoverage * 100).toFixed(1)
    const modelLabel = cfg.codeModel
      ? `${cfg.model} / code:${cfg.codeModel}`
      : cfg.model
    const configDetail = cfg.dimensions > 0
      ? `${cfg.dimensions}d, chunker:${cfg.chunker}`
      : `chunker:${cfg.chunker}`
    lines.push(`  Model: ${modelLabel}  (${configDetail})`)
    lines.push(`    file blobs:   ${cfg.fileBlobsEmbedded.toLocaleString()} / ${status.gitReachableBlobs > 0 ? status.gitReachableBlobs.toLocaleString() : '?'} (${pct}%)`)
    if (cfg.chunksEmbedded > 0) {
      lines.push(`    chunks:       ${cfg.chunksEmbedded.toLocaleString()}`)
    }
    if (cfg.symbolsEmbedded > 0) {
      lines.push(`    symbols:      ${cfg.symbolsEmbedded.toLocaleString()}`)
    }
    if (cfg.modulesEmbedded > 0) {
      lines.push(`    modules:      ${cfg.modulesEmbedded.toLocaleString()}`)
    }
  }

  lines.push('')
  lines.push('Run `gitsema index start` to index new blobs.')
  lines.push('Run `gitsema index start --since all` to force a full re-index.')

  return lines.join('\n')
}
