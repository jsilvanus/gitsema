/**
 * `gitsema storage migrate` (Phase 103).
 *
 * Copies the active index (resolved from `storage.*` config / env, as usual)
 * into a destination profile described by `--to*` flags, via
 * `migrateStorage()`. See docs/storage-backends-plan.md §8.
 */

import { getCachedStorageProfile, withStorageProfile } from '../../core/storage/resolveProfile.js'
import { migrateStorage } from '../../core/storage/migrate.js'
import { SqliteStorageProfile } from '../../core/storage/sqlite/profile.js'
import { PostgresStorageProfile } from '../../core/storage/postgres/profile.js'
import type { PostgresFtsBackend } from '../../core/storage/postgres/ftsStore.js'
import { QdrantStorageProfile } from '../../core/storage/qdrant/profile.js'
import type { StorageProfile } from '../../core/storage/types.js'

export interface StorageMigrateOptions {
  to: string
  toMetadataUrl?: string
  toVectorsUrl?: string
  toVectorsApiKey?: string
  toFtsBackend?: string
  toPath?: string
}

function buildDestinationProfile(source: StorageProfile, opts: StorageMigrateOptions): StorageProfile {
  const ftsBackend = (opts.toFtsBackend ?? 'tsvector').toLowerCase()
  if (ftsBackend !== 'none' && ftsBackend !== 'tsvector' && ftsBackend !== 'pg_search') {
    throw new Error(`Invalid --to-fts-backend '${ftsBackend}' (expected: tsvector | pg_search | none)`)
  }
  const ftsEnabled = ftsBackend !== 'none'

  switch (opts.to) {
    case 'sqlite': {
      if (!opts.toPath) throw new Error("storage migrate --to sqlite requires --to-path <file>")
      return new SqliteStorageProfile(source.scope, opts.toPath, ftsEnabled)
    }
    case 'postgres': {
      if (!opts.toMetadataUrl) throw new Error("storage migrate --to postgres requires --to-metadata-url <postgres://...>")
      return new PostgresStorageProfile(source.scope, opts.toMetadataUrl, ftsEnabled, ftsBackend as PostgresFtsBackend)
    }
    case 'qdrant': {
      if (!opts.toMetadataUrl) throw new Error("storage migrate --to qdrant requires --to-metadata-url <postgres://...> (relational companion)")
      if (!opts.toVectorsUrl) throw new Error("storage migrate --to qdrant requires --to-vectors-url <http://...>")
      return new QdrantStorageProfile(source.scope, opts.toVectorsUrl, opts.toMetadataUrl, opts.toVectorsApiKey, ftsEnabled, ftsBackend as PostgresFtsBackend)
    }
    default:
      throw new Error(`Invalid --to '${opts.to}' (expected: sqlite | postgres | qdrant)`)
  }
}

export async function storageMigrateCommand(opts: StorageMigrateOptions): Promise<void> {
  const source = getCachedStorageProfile(process.cwd())
  const dest = buildDestinationProfile(source, opts)

  console.log(`Migrating ${source.backend} (${source.location}) -> ${dest.backend} (${dest.location})...`)
  // Destination writes for the sqlite adapter go through getActiveSession();
  // activate dest's session for the duration of the migration (no-op for
  // postgres/qdrant, which hold their own pool/client).
  const stats = await withStorageProfile(dest, () => migrateStorage(source, dest))

  console.log('Done.')
  console.log(`  blobs:            ${stats.blobs}`)
  console.log(`  paths:            ${stats.paths}`)
  console.log(`  file embeddings:  ${stats.fileEmbeddings}`)
  console.log(`  fts entries:      ${stats.ftsEntries}`)
  console.log(`  commits:          ${stats.commits}`)
  console.log(`  blob<->commit:    ${stats.blobCommits}`)
  console.log(`  blob<->branch:    ${stats.blobBranches}`)
  console.log(`  indexed commits:  ${stats.indexedCommits}`)
  console.log(`  chunk embeddings: ${stats.chunkEmbeddings}`)
  console.log(`  symbol embeddings:${stats.symbolEmbeddings}`)
  console.log(`  module embeddings:${stats.moduleEmbeddings}`)
  console.log(`  commit embeddings:${stats.commitEmbeddings}`)
}
