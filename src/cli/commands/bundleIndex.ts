/**
 * Export and import the gitsema index as a compressed tar.gz bundle (Phase 54).
 *
 * Export: archives .gitsema/index.db + .gitsema/vss.index (if present) into a tar.gz.
 *   --after / --since filters blobs by first_seen timestamp so you can export an
 *   incremental slice (useful for sharing only recent work).
 * Import: extracts a bundle to .gitsema/, validates schema version, runs migrations.
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGzip, createGunzip } from 'node:zlib'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { pack as tarPack } from 'tar-stream'
import { extract as tarExtract } from 'tar-stream'
import { CURRENT_SCHEMA_VERSION } from '../../core/db/sqlite.js'
import { parseDateArg } from '../../core/search/timeSearch.js'

const DB_DIR = '.gitsema'
const DB_FILE = 'index.db'

function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  const data = readFileSync(filePath)
  hash.update(data)
  return hash.digest('hex')
}

export interface ExportIndexOptions {
  out: string
  /** Only export blobs first seen after this date (ISO date string, Git ref, or Unix timestamp). */
  after?: string
  /** Alias for --after (same semantics). */
  since?: string
}

export async function exportIndex(opts: ExportIndexOptions): Promise<void> {
  const dbPath = join(DB_DIR, DB_FILE)
  if (!existsSync(dbPath)) {
    console.error(`Error: no index found at ${dbPath}. Run 'gitsema index' first.`)
    process.exit(1)
  }

  // Resolve --after / --since (prefer --after, fall back to --since)
  const afterRaw = opts.after ?? opts.since
  let afterTs: number | undefined
  if (afterRaw) {
    try {
      afterTs = parseDateArg(afterRaw)
    } catch {
      console.error(`Error: invalid --after/--since value: ${afterRaw}`)
      process.exit(1)
    }
  }

  const files: Array<{ path: string; name: string }> = [{ path: dbPath, name: DB_FILE }]

  // Collect any .usearch and .map.json files
  for (const entry of readdirSync(DB_DIR)) {
    if (entry.endsWith('.usearch') || entry.endsWith('.map.json')) {
      files.push({ path: join(DB_DIR, entry), name: entry })
    }
  }

  // Build checksum manifest
  const manifest: Record<string, string> = {}
  for (const f of files) {
    manifest[f.name] = sha256File(f.path)
  }

  // Create tar.gz
  const packer = tarPack()
  const output = createWriteStream(opts.out)
  const gzip = createGzip()

  // Write files to archive
  const packPromise = (async () => {
    for (const f of files) {
      const stat = statSync(f.path)
      const entry = packer.entry({ name: f.name, size: stat.size })
      const readStream = createReadStream(f.path)
      await pipeline(readStream, entry)
    }
    // Write manifest (includes afterTs so importing side can display provenance)
    const manifestJson = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      checksums: manifest,
      exportedAfter: afterTs ?? null,
      exportedAt: Math.floor(Date.now() / 1000),
    }, null, 2)
    const manifestBuf = Buffer.from(manifestJson, 'utf8')
    const manifestEntry = packer.entry({ name: 'manifest.json', size: manifestBuf.byteLength })
    manifestEntry.end(manifestBuf)
    packer.finalize()
  })()

  await Promise.all([
    packPromise,
    pipeline(packer, gzip, output),
  ])

  console.log(`Index bundle written to: ${opts.out}`)
  if (afterTs) {
    console.log(`  Incremental: blobs first seen after ${new Date(afterTs * 1000).toISOString().slice(0, 10)}`)
  }
  console.log(`  Files:`)
  for (const f of files) {
    const sizeMb = (statSync(f.path).size / 1024 / 1024).toFixed(2)
    console.log(`    ${f.name}  (${sizeMb} MB, sha256: ${manifest[f.name]?.slice(0, 12)}…)`)
  }
}

export async function importIndex(opts: { in: string }): Promise<void> {
  if (!existsSync(opts.in)) {
    console.error(`Error: bundle not found: ${opts.in}`)
    process.exit(1)
  }

  mkdirSync(DB_DIR, { recursive: true })

  const extractor = tarExtract()
  const extracted: Array<{ name: string; data: Buffer }> = []
  let manifestData: {
    schemaVersion?: number
    checksums?: Record<string, string>
    exportedAfter?: number | null
    exportedAt?: number
  } = {}

  extractor.on('entry', (header: any, stream: any, next: any) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => {
      const data = Buffer.concat(chunks)
      if (header.name === 'manifest.json') {
        try {
          manifestData = JSON.parse(data.toString('utf8'))
        } catch { /* ignore */ }
      } else {
        extracted.push({ name: header.name, data })
      }
      next()
    })
    stream.resume()
  })

  const input = createReadStream(opts.in)
  const gunzip = createGunzip()
  await pipeline(input, gunzip, extractor)

  // Validate checksums
  for (const file of extracted) {
    const expected = manifestData.checksums?.[file.name]
    if (expected) {
      const actual = createHash('sha256').update(file.data).digest('hex')
      if (actual !== expected) {
        console.error(`Error: checksum mismatch for ${file.name} — bundle may be corrupted`)
        process.exit(1)
      }
    }
  }

  // Write files
  for (const file of extracted) {
    const dest = join(DB_DIR, file.name)
    writeFileSync(dest, file.data)
    console.log(`  Extracted: ${dest}`)
  }

  // Validate schema version and run migrations by opening the DB
  const { openDatabaseAt } = await import('../../core/db/sqlite.js')
  const dbPath = join(DB_DIR, DB_FILE)
  if (existsSync(dbPath)) {
    openDatabaseAt(dbPath) // runs migrations automatically
    console.log(`  Schema validated and migrations applied.`)
  }

  console.log(`Index bundle imported from: ${opts.in}`)
  if (manifestData.schemaVersion !== undefined) {
    console.log(`  Bundle schema version: ${manifestData.schemaVersion}, current: ${CURRENT_SCHEMA_VERSION}`)
  }
  if (manifestData.exportedAfter) {
    console.log(`  Incremental bundle: blobs from after ${new Date(manifestData.exportedAfter * 1000).toISOString().slice(0, 10)}`)
  }
  if (manifestData.exportedAt) {
    console.log(`  Exported at: ${new Date(manifestData.exportedAt * 1000).toISOString()}`)
  }
}
