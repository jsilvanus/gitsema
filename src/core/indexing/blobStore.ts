import { getActiveSession } from '../db/sqlite.js'
import { blobs, embeddings, paths, commits, blobCommits, indexedCommits, chunks, chunkEmbeddings, blobBranches, symbols, symbolEmbeddings } from '../db/schema.js'
import { inArray, desc } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import type { BlobHash, Embedding } from '../models/types.js'
import type { FileCategory } from '../embedding/fileType.js'
import type { CommitEntry } from '../git/commitMap.js'

export interface StoreBlobArgs {
  blobHash: BlobHash
  size: number
  path: string
  model: string
  embedding: Embedding
  fileType?: FileCategory
  /** Raw text content for FTS5 hybrid search indexing. */
  content?: string
}

/**
 * Writes a blob, its embedding, and its path in a single transaction.
 * Safe to call multiple times for the same blobHash with different paths
 * (the blob/embedding rows are skipped via INSERT OR IGNORE; a new path row is added).
 * When `content` is provided it is also upserted into the FTS5 `blob_fts` table
 * so the blob is searchable via hybrid (BM25 + vector) queries.
 */
export function storeBlob(args: StoreBlobArgs): void {
  const { blobHash, size, path, model, embedding, fileType, content } = args
  const { db, rawDb } = getActiveSession()

  // Serialize float32 embedding to a Buffer
  const vector = Buffer.from(new Float32Array(embedding).buffer)

  db.transaction((tx) => {
    tx.insert(blobs)
      .values({ blobHash, size, indexedAt: Date.now() })
      .onConflictDoNothing()
      .run()

    tx.insert(embeddings)
      .values({ blobHash, model, dimensions: embedding.length, vector, fileType: fileType ?? null })
      .onConflictDoNothing()
      .run()

    tx.insert(paths)
      .values({ blobHash, path })
      .run()
  })

  // Upsert into FTS5 table (outside Drizzle transaction — FTS5 does not participate in them)
  if (content !== undefined) {
    storeFtsContent(blobHash, content)
  }
}

export interface StoreBlobRecordArgs {
  blobHash: BlobHash
  size: number
  path: string
  /** Raw text content for FTS5 hybrid search indexing. */
  content?: string
}

/**
 * Writes a blob record and its path without any embedding.
 * Used by the chunked indexing path where embeddings are stored per-chunk
 * rather than per-blob.  Safe to call multiple times for the same blobHash;
 * the blob row is silently skipped and only a new path row is added.
 * When `content` is provided it is also upserted into the FTS5 `blob_fts` table.
 */
export function storeBlobRecord(args: StoreBlobRecordArgs): void {
  const { blobHash, size, path, content } = args
  const { db } = getActiveSession()

  db.transaction((tx) => {
    tx.insert(blobs)
      .values({ blobHash, size, indexedAt: Date.now() })
      .onConflictDoNothing()
      .run()

    tx.insert(paths)
      .values({ blobHash, path })
      .run()
  })

  if (content !== undefined) {
    storeFtsContent(blobHash, content)
  }
}

/**
 * Retrieves the stored text content for a blob from the FTS5 table.
 * Returns undefined if the blob has no content stored (e.g. it was indexed
 * before Phase 11 without the FTS5 table, or content was omitted).
 */
export function getBlobContent(blobHash: string): string | undefined {
  const { rawDb } = getActiveSession()
  const row = rawDb.prepare(`SELECT content FROM blob_fts WHERE blob_hash = ?`).get(blobHash) as
    | { content: string }
    | undefined
  return row?.content
}

/**
 * Upserts blob content into the FTS5 `blob_fts` table.
 * Uses a DELETE + INSERT pattern because FTS5 does not support ON CONFLICT.
 */
export function storeFtsContent(blobHash: string, content: string): void {
  const { rawDb } = getActiveSession()
  rawDb.prepare(`DELETE FROM blob_fts WHERE blob_hash = ?`).run(blobHash)
  rawDb.prepare(`INSERT INTO blob_fts (blob_hash, content) VALUES (?, ?)`).run(blobHash, content)
}

/**
 * Stores a commit and its associated blob-commit links in a single transaction.
 * Only creates blobCommit rows for blobs that are already indexed in the blobs table.
 * Returns the number of blobCommit rows stored.
 */
export function storeCommitWithBlobs(commit: CommitEntry, blobHashes: string[]): number {
  const { db } = getActiveSession()

  if (blobHashes.length === 0) {
    db.insert(commits)
      .values({ commitHash: commit.commitHash, timestamp: commit.timestamp, message: commit.message, authorName: commit.authorName ?? null, authorEmail: commit.authorEmail ?? null })
      .onConflictDoNothing()
      .run()
    return 0
  }

  // Deduplicate input hashes
  const uniqueHashes = [...new Set(blobHashes)]

  // Pre-filter: find which hashes are already indexed using a single IN query
  const BATCH = 500
  const indexedSet = new Set<string>()
  for (let i = 0; i < uniqueHashes.length; i += BATCH) {
    const batch = uniqueHashes.slice(i, i + BATCH)
    const rows = db.select({ blobHash: blobs.blobHash })
      .from(blobs)
      .where(inArray(blobs.blobHash, batch))
      .all()
    for (const row of rows) indexedSet.add(row.blobHash)
  }

  const indexedHashes = uniqueHashes.filter((h) => indexedSet.has(h))

  db.transaction((tx) => {
    tx.insert(commits)
      .values({ commitHash: commit.commitHash, timestamp: commit.timestamp, message: commit.message, authorName: commit.authorName ?? null, authorEmail: commit.authorEmail ?? null })
      .onConflictDoNothing()
      .run()

    for (const blobHash of indexedHashes) {
      tx.insert(blobCommits)
        .values({ blobHash, commitHash: commit.commitHash })
        .onConflictDoNothing()
        .run()
    }
  })

  return indexedHashes.length
}

/**
 * Records a commit hash in the `indexed_commits` table, marking it as fully
 * processed by the indexer. Used by incremental indexing to determine the
 * default `--since` value on subsequent runs.
 */
export function markCommitIndexed(commitHash: string): void {
  const { db } = getActiveSession()
  db.insert(indexedCommits)
    .values({ commitHash, indexedAt: Date.now() })
    .onConflictDoNothing()
    .run()
}

/**
 * Returns the most recently indexed commit hash, or undefined if the index
 * has never been built. Used to default `--since` to the last indexed point.
 */
export function getLastIndexedCommit(): string | undefined {
  const { db } = getActiveSession()
  const row = db
    .select({ commitHash: indexedCommits.commitHash })
    .from(indexedCommits)
    .orderBy(desc(indexedCommits.indexedAt))
    .limit(1)
    .get()
  return row?.commitHash
}

export interface StoreChunkArgs {
  blobHash: BlobHash
  startLine: number
  endLine: number
  model: string
  embedding: Embedding
}

/**
 * Writes a single chunk and its embedding to the database in one transaction.
 * Returns the newly created chunk id.
 */
export function storeChunk(args: StoreChunkArgs): number {
  const { blobHash, startLine, endLine, model, embedding } = args
  const { db, rawDb } = getActiveSession()
  const vector = Buffer.from(new Float32Array(embedding).buffer)

  // Avoid creating duplicate chunks for the same blob/start/end by checking
  // for an existing row first. If a chunk exists but lacks an embedding row,
  // insert the embedding. Otherwise create both rows in a transaction.
  // Use raw sqlite to check for an existing chunk row matching the same
  // blob/start/end triple to avoid duplicate chunk rows.
  const existingRow = rawDb
    .prepare('SELECT id FROM chunks WHERE blob_hash = ? AND start_line = ? AND end_line = ?')
    .get(blobHash, startLine, endLine) as { id: number } | undefined

  if (existingRow) {
    const embRow = db
      .select({ chunkId: chunkEmbeddings.chunkId })
      .from(chunkEmbeddings)
      .where(eq(chunkEmbeddings.chunkId, existingRow.id))
      .get()

    if (embRow) return existingRow.id

    // Insert missing embedding for existing chunk
    db.insert(chunkEmbeddings)
      .values({ chunkId: existingRow.id, model, dimensions: embedding.length, vector })
      .run()

    return existingRow.id
  }

  const result = db.transaction((tx) => {
    const chunkRow = tx
      .insert(chunks)
      .values({ blobHash, startLine, endLine })
      .returning({ id: chunks.id })
      .get()

    tx.insert(chunkEmbeddings)
      .values({ chunkId: chunkRow.id, model, dimensions: embedding.length, vector })
      .run()

    return chunkRow.id
  })

  return result
}

/**
 * Records that the given blob was seen on each of the provided branches.
 * Uses INSERT OR IGNORE so duplicate (blobHash, branchName) pairs are silently skipped.
 * No-ops when `branches` is empty or the blob is not yet in the `blobs` table.
 */
export function storeBlobBranches(blobHash: string, branches: string[]): void {
  if (branches.length === 0) return
  const { rawDb } = getActiveSession()
  const stmt = rawDb.prepare(
    'INSERT OR IGNORE INTO blob_branches (blob_hash, branch_name) VALUES (?, ?)',
  )
  for (const branchName of branches) {
    stmt.run(blobHash, branchName)
  }
}

export interface StoreSymbolArgs {
  blobHash: BlobHash
  startLine: number
  endLine: number
  symbolName: string
  symbolKind: string
  language: string
  model: string
  embedding: Embedding
}

/**
 * Writes a symbol record and its enriched embedding in a single transaction.
 *
 * The symbol records the named declaration boundary (function, class, method,
 * impl, etc.) along with its symbol name, kind, and detected language.  The
 * `embedding` is expected to have been computed from enriched text that
 * includes the file path, symbol name, and source lines — not just the raw
 * code content — so that natural-language queries resolve to the right symbol.
 *
 * If an identical (blobHash, startLine, endLine, symbolName) row already exists
 * the call is a no-op; this makes the function safe to call multiple times for
 * the same symbol (e.g. during a re-index).
 *
 * Returns the newly created (or existing) symbol id.
 */
export function storeSymbol(args: StoreSymbolArgs): number {
  const { blobHash, startLine, endLine, symbolName, symbolKind, language, model, embedding } = args
  const { db, rawDb } = getActiveSession()
  const vector = Buffer.from(new Float32Array(embedding).buffer)

  const existing = rawDb
    .prepare(
      'SELECT id FROM symbols WHERE blob_hash = ? AND start_line = ? AND end_line = ? AND symbol_name = ?',
    )
    .get(blobHash, startLine, endLine, symbolName) as { id: number } | undefined

  if (existing) {
    // Upsert the embedding in case it was missing (e.g. previous partial run)
    db.insert(symbolEmbeddings)
      .values({ symbolId: existing.id, model, dimensions: embedding.length, vector })
      .onConflictDoNothing()
      .run()
    return existing.id
  }

  return db.transaction((tx) => {
    const symbolRow = tx
      .insert(symbols)
      .values({ blobHash, startLine, endLine, symbolName, symbolKind, language })
      .returning({ id: symbols.id })
      .get()

    tx.insert(symbolEmbeddings)
      .values({ symbolId: symbolRow.id, model, dimensions: embedding.length, vector })
      .run()

    return symbolRow.id
  })
}
