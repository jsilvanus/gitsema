import { remoteStatus } from '../../client/remoteClient.js'
import { db, DB_PATH, getRawDb } from '../../core/db/sqlite.js'
import { blobs, embeddings, paths, chunks, chunkEmbeddings, symbols, symbolEmbeddings, commitEmbeddings, moduleEmbeddings } from '../../core/db/schema.js'
import { eq } from 'drizzle-orm'
import { logger } from '../../utils/logger.js'
import { walk } from '../../core/git/walker.js'
import { execSync } from 'node:child_process'
import { resolve as pathResolve, relative as pathRelative } from 'node:path'
import { OllamaProvider } from '../../core/embedding/local.js'
import { sql } from 'drizzle-orm'
import { getBlobContent } from '../../core/indexing/blobStore.js'
import { readFileSync } from 'node:fs'
import { resolveBlobAtRef } from '../../core/search/evolution.js'
import { shortHash } from '../../core/search/ranking.js'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface StatusCommandOptions {
  remote?: string
}

export async function statusCommand(filePath: string | undefined, options: StatusCommandOptions = {}): Promise<void> {
  const remoteUrl = options.remote ?? process.env.GITSEMA_REMOTE
  if (remoteUrl) {
    process.env.GITSEMA_REMOTE = remoteUrl
    try {
      const status = await remoteStatus()
      console.log(`Remote: ${remoteUrl}`)
      console.log(`DB path:           ${status.dbPath}`)
      console.log(`Model:             ${status.model}`)
      if (status.codeModel) console.log(`Code model:        ${status.codeModel}`)
      console.log(`Blobs indexed:     ${status.blobs}`)
      console.log(`Embeddings stored: ${status.embeddings}`)
      console.log(`Chunks stored:     ${status.chunks}`)
      console.log(`Commits mapped:    ${status.commits}`)
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
    return
  }

  const [blobCount] = db.select({ count: sql<number>`count(*)` }).from(blobs).all()
  const [embeddingCount] = db.select({ count: sql<number>`count(*)` }).from(embeddings).all()
  const [pathCount] = db.select({ count: sql<number>`count(*)` }).from(paths).all()

  // Extended indexing level counts
  const rawDb = getRawDb()
  const chunkCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM chunks').get() as { c: number })?.c ?? 0
  const chunkEmbCount = (rawDb.prepare('SELECT COUNT(*) AS c FROM chunk_embeddings').get() as { c: number })?.c ?? 0
  const symbolCount = (rawDb.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='symbols'").get() as { c: number })?.c
    ? (rawDb.prepare('SELECT COUNT(*) AS c FROM symbols').get() as { c: number })?.c ?? 0
    : 0
  const symbolEmbCount = (rawDb.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='symbol_embeddings'").get() as { c: number })?.c
    ? (rawDb.prepare('SELECT COUNT(*) AS c FROM symbol_embeddings').get() as { c: number })?.c ?? 0
    : 0
  const commitEmbCount = (rawDb.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='commit_embeddings'").get() as { c: number })?.c
    ? (rawDb.prepare('SELECT COUNT(*) AS c FROM commit_embeddings').get() as { c: number })?.c ?? 0
    : 0
  const moduleEmbCount = (rawDb.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='module_embeddings'").get() as { c: number })?.c
    ? (rawDb.prepare('SELECT COUNT(*) AS c FROM module_embeddings').get() as { c: number })?.c ?? 0
    : 0

  // Resolve provider config from env or defaults
  const providerType = process.env.GITSEMA_PROVIDER ?? 'ollama'
  const textModel = process.env.GITSEMA_TEXT_MODEL ?? process.env.GITSEMA_MODEL ?? 'nomic-embed-text'
  const codeModel = process.env.GITSEMA_CODE_MODEL ?? textModel
  const dualModel = codeModel !== textModel

  // Read package.json version dynamically so status shows accurate version
  let pkgVersion = '0.0.0'
  try {
    const pkgPath = new URL('../../../package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (pkg && typeof pkg.version === 'string') pkgVersion = pkg.version
  } catch {
    // fall back
  }

  function printKV(key: string, value: string | number): void {
    const k = key.padEnd(20)
    const line = `${k} ${value}`
    logger.info(line)
  }
  printKV(`gitsema v${pkgVersion}`, '')
  printKV('DB:', DB_PATH)
  printKV('Provider:', providerType)
  if (dualModel) {
    printKV('Text model:', textModel)
    printKV('Code model:', codeModel)
  } else {
    printKV('Model:', textModel)
  }
  const branchCount = (getRawDb()
    .prepare('SELECT COUNT(DISTINCT branch_name) AS c FROM blob_branches')
    .get() as { c: number } | undefined)?.c ?? 0

  printKV('Blobs indexed:', blobCount.count)
  printKV('Embeddings stored:', embeddingCount.count)
  printKV('Path entries:', pathCount.count)
  printKV('Branches tracked:', branchCount)
  if (chunkCount > 0) printKV('Chunks stored:', chunkCount)
  if (chunkEmbCount > 0) printKV('Chunk embeddings:', chunkEmbCount)
  if (symbolCount > 0) printKV('Symbols indexed:', symbolCount)
  if (symbolEmbCount > 0) printKV('Symbol embeddings:', symbolEmbCount)
  if (commitEmbCount > 0) printKV('Commit embeddings:', commitEmbCount)
  if (moduleEmbCount > 0) printKV('Module embeddings:', moduleEmbCount)

  if (filePath) {
    // Resolve blob at HEAD (try as-given first)
    let blob = await resolveBlobAtRef('HEAD', filePath)
    let resolvedPath = filePath
    if (!blob) {
      try {
        const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
        // Use git's prefix to compute the repo-relative path when invoked from a subdirectory.
        const prefix = execSync('git rev-parse --show-prefix', { encoding: 'utf8' }).trim()
        const rel = (prefix + filePath).replace(/\\/g, '/')
        if (rel && rel !== filePath) {
          const alt = await resolveBlobAtRef('HEAD', rel, repoRoot)
          if (alt) {
            blob = alt
            resolvedPath = rel
          }
        }
      } catch {
        // ignore path resolution errors
      }
    }
    if (!blob) {
      console.log(`\nFile: ${filePath} — not present at HEAD`)
      return
    }

    console.log('')
    console.log(`File: ${resolvedPath}`)
    console.log(`  Blob: ${shortHash(blob)} (${blob})`)

    // Check embedding presence
    const embRow = db.select({ c: sql<number>`count(*)` }).from(embeddings).where(eq(embeddings.blobHash, blob)).all()[0]
    const embCount = embRow?.c ?? 0
    console.log(`  Embedding present: ${embCount > 0 ? 'yes' : 'no'}`)

    // Check chunk embeddings for this blob
    const chunkRows = db.select({ c: sql<number>`count(*)` })
      .from(chunks)
      .where(eq(chunks.blobHash, blob))
      .all()
    const chunkCount = chunkRows[0]?.c ?? 0
    const chunkEmbRows = db.select({ c: sql<number>`count(*)` })
      .from(chunkEmbeddings)
      .all()
    console.log(`  Chunk entries: ${chunkCount}`)

    // If verbose, list each chunk's line range and a short snippet.
    if (process.env.GITSEMA_VERBOSE === '1') {
      const rows = db.select({ start: chunks.startLine, end: chunks.endLine })
        .from(chunks)
        .where(eq(chunks.blobHash, blob))
        .orderBy(chunks.startLine)
        .all()

      const content = getBlobContent(blob)
      const lines = content ? content.split(/\r?\n/) : null

      console.log('  Chunk list:')
      for (const r of rows) {
        const start = r.start as number
        const end = r.end as number
        let snippet = ''
        if (lines) {
          const firstLineRaw = lines[start - 1] ?? ''
          const lastLineRaw = lines[end - 1] ?? ''
          const firstPart = firstLineRaw.slice(0, 15).replace(/\s+/g, ' ')
          const lastPart = lastLineRaw.length > 15 ? lastLineRaw.slice(-15) : lastLineRaw
          snippet = start === end ? `${firstPart}` : `${firstPart} ... ${lastPart}`
          snippet = snippet.replace(/\n/g, '\\n')
        }
        console.log(`    - ${start}-${end}${snippet ? `: ${snippet}` : ''}`)
      }
    }
    return
  }

  // Check if provider is reachable
  if (providerType === 'ollama') {
    const provider = new OllamaProvider({ model: textModel })
    try {
      await provider.embed('ping')
      logger.info(`Provider status:   reachable (dimensions: ${provider.dimensions})`)
    } catch {
      logger.warn(`Provider status:   unreachable (is Ollama running?)`)
    }
  }

  console.log('')
  logger.info('Scanning repo blobs...')

  const stats = await walk({ repoPath: '.' })

  console.log(`Repo unique blobs: ${stats.seen}`)
  console.log(`Blobs skipped:     ${stats.skipped} (over size limit)`)
  console.log(`Total blob data:   ${formatBytes(stats.totalBytes)}`)
}
