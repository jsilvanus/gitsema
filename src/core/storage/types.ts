/**
 * Storage seam (Phase 101).
 *
 * gitsema's persisted data is modeled as three collaborating stores so that
 * each can be backed by a different technology (see docs/storage-backends-plan.md):
 *
 *   - MetadataStore — relational facts that are always present (blobs, paths,
 *     commits, branches, …). Backed by SQLite today; Postgres later.
 *   - VectorStore   — embeddings + similarity search. SQLite BLOB today;
 *     pgvector / Qdrant later.
 *   - FtsStore      — keyword / BM25 search. SQLite FTS5 today; Postgres
 *     tsvector / an external engine later. OPTIONAL: a profile may set this to
 *     `null`, in which case hybrid (keyword) search is unavailable.
 *
 * All methods are async. The SQLite adapter wraps the existing synchronous
 * better-sqlite3 calls in resolved promises (zero real cost); async-native
 * backends (Postgres, Qdrant) plug in behind the same interface without
 * touching callers. Call sites migrate to this seam slice by slice.
 */

import type { Embedding, SearchResult } from '../models/types.js'
import type { VectorSearchOptions } from '../search/analysis/vectorSearch.js'
import type { CommitSearchOptions, CommitSearchResult } from '../search/commitSearch.js'

/** Which technology backs a profile. Only `sqlite` is implemented in Phase 101. */
export type StorageBackend = 'sqlite' | 'postgres' | 'qdrant'

/**
 * Which index a command resolves to (see plan §2, Axis A).
 *   - project — one index per git repo (`.gitsema/`), today's default
 *   - user    — one index shared across a user's repos (`~/.gitsema/`)
 *   - named   — an explicitly addressed index
 */
export type StorageScope = 'project' | 'user' | 'named'

/** A single keyword-search hit. `score` is the raw BM25 value (lower is better). */
export interface Bm25Hit {
  blobHash: string
  score: number
}

/**
 * Relational metadata operations. This is intentionally a minimal slice for
 * Phase 101 (the operations needed by the dedup and result-assembly paths);
 * it grows as call sites migrate to the seam.
 */
export interface MetadataStore {
  /** True if the blob already has a whole-file embedding for `model`. */
  isIndexed(blobHash: string, model: string): Promise<boolean>
  /** Returns the subset of `hashes` that do NOT yet have an embedding for `model`. */
  filterNewBlobs(hashes: string[], model: string): Promise<Set<string>>
  /** Maps each requested blob hash to its known file paths. */
  pathsFor(blobHashes: string[]): Promise<Map<string, string[]>>
}

/** Vector similarity search + counts over the embedding tables. */
export interface VectorStore {
  /** File/chunk/symbol/module similarity search (mode selected via options). */
  search(queryEmbedding: Embedding, options?: VectorSearchOptions): Promise<SearchResult[]>
  /** Commit-message similarity search. */
  searchCommits(queryEmbedding: Embedding, options?: CommitSearchOptions): Promise<CommitSearchResult[]>
  /** Number of whole-file embeddings, optionally filtered to a model. */
  countFileEmbeddings(model?: string): Promise<number>
}

/** Keyword / BM25 store. Optional — a profile may have `fts: null`. */
export interface FtsStore {
  /** Upsert the searchable text content for a blob. */
  index(blobHash: string, content: string): Promise<void>
  /** Retrieve the stored text content for a blob, if any. */
  get(blobHash: string): Promise<string | undefined>
  /** BM25 keyword search; returns up to `limit` hits ordered best-first. */
  search(query: string, limit: number): Promise<Bm25Hit[]>
  /** Remove stored content for the given blobs. */
  delete(blobHashes: string[]): Promise<void>
}

/**
 * A resolved storage profile: the three stores plus the metadata describing how
 * they were resolved. Built by `resolveStorageProfile()`.
 */
export interface StorageProfile {
  readonly backend: StorageBackend
  readonly scope: StorageScope
  /** Absolute path / connection string of the metadata store (a file for SQLite). */
  readonly location: string
  readonly metadata: MetadataStore
  readonly vectors: VectorStore
  readonly fts: FtsStore | null
}
