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
import type { CommitEntry } from '../git/commitMap.js'
import type { FileCategory } from '../embedding/fileType.js'

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

/** Basic row counts used for `gitsema status` / `gitsema doctor` reporting. */
export interface StorageStats {
  blobCount: number
  pathCount: number
  commitCount: number
  indexedCommitCount: number
  branchCount: number
  lastIndexedCommit?: string
}

/** Which embedding table a `VectorStore.upsert`/`delete` call targets. */
export type VectorKind = 'file' | 'chunk' | 'symbol' | 'module' | 'commit'

/**
 * A single vector to upsert. `id` is the natural key for `kind`:
 *   - file/chunk/symbol → `blobHash` (chunk/symbol additionally carry line
 *     ranges / symbol metadata so the row can be created if missing)
 *   - module            → `modulePath`
 *   - commit            → `commitHash`
 */
export interface VectorRecord {
  id: string
  model: string
  dimensions: number
  embedding: Embedding
  quantize?: boolean
  startLine?: number
  endLine?: number
  symbolName?: string
  symbolKind?: string
  language?: string
  blobCount?: number
  /** Path-free qualified name (scope chain joined by '.'). symbol kind only (Phase 105). */
  qualifiedName?: string
  /** Normalized parameter-list signature, e.g. "(token:string)". symbol kind only (Phase 105). */
  signature?: string
  /** First 12 hex chars of sha1(signature). symbol kind only (Phase 105). */
  signatureHash?: string
  /** Enclosing scope's qualified name, or undefined at top level. symbol kind only (Phase 105). */
  parentQualifiedName?: string
}

/**
 * Relational metadata operations. This is intentionally a minimal slice for
 * Phase 101/102 (the operations needed by the dedup, result-assembly, and
 * indexing-write paths); it grows as call sites migrate to the seam.
 */
export interface MetadataStore {
  /** True if the blob already has a whole-file embedding for `model`. */
  isIndexed(blobHash: string, model: string): Promise<boolean>
  /** Returns the subset of `hashes` that do NOT yet have an embedding for `model`. */
  filterNewBlobs(hashes: string[], model: string): Promise<Set<string>>
  /** Maps each requested blob hash to its known file paths. */
  pathsFor(blobHashes: string[]): Promise<Map<string, string[]>>
  /** Registers a blob (content-addressed; safe to call repeatedly). */
  putBlob(blobHash: string, size: number): Promise<void>
  /** Adds a path for a blob (no-op if the (blobHash, path) pair already exists). */
  addPath(blobHash: string, path: string): Promise<void>
  /** Registers a commit (safe to call repeatedly). */
  putCommit(commit: CommitEntry): Promise<void>
  /** Links a commit to the blobs it introduced/touched; returns the number of new links. */
  linkBlobCommits(commitHash: string, blobHashes: string[]): Promise<number>
  /** Records that a commit's branch associations include the given blobs. */
  setBlobBranches(blobHash: string, branches: string[]): Promise<void>
  /** Marks a commit as fully processed (used to default `--since` on the next run). */
  markCommitIndexed(commitHash: string): Promise<void>
  /** Returns the most recently indexed commit hash, or undefined if never indexed. */
  getLastIndexedCommit(): Promise<string | undefined>
  /** Basic row counts for `gitsema status` / `gitsema doctor` reporting. */
  getStats(): Promise<StorageStats>
  /**
   * Stores the structural-reference rows extracted from one blob (Phase 106,
   * knowledge-graph §3.2). Immutable and dedup'd by `blobHash` — a no-op if
   * rows already exist for this blob.
   */
  storeStructuralRefs(blobHash: string, refs: StructuralRefRecord[]): Promise<void>
}

/** A raw structural reference to persist for one blob (Phase 106, knowledge-graph §3.2). */
export interface StructuralRefRecord {
  /** Path-free qualified name of the referencing scope, or undefined = file/top-level scope. */
  enclosingQualifiedName?: string
  /** One of: import | call | extends | implements | reference. */
  refKind: 'import' | 'call' | 'extends' | 'implements' | 'reference'
  /** Literal text as written: imported name, callee name, base class name, etc. */
  rawTarget: string
  /** For imports: the raw, unresolved module specifier. */
  targetModule?: string
  /** 1-indexed line number. */
  line: number
}

/** Vector similarity search + counts over the embedding tables. */
export interface VectorStore {
  /** File/chunk/symbol/module similarity search (mode selected via options). */
  search(queryEmbedding: Embedding, options?: VectorSearchOptions): Promise<SearchResult[]>
  /** Commit-message similarity search. */
  searchCommits(queryEmbedding: Embedding, options?: CommitSearchOptions): Promise<CommitSearchResult[]>
  /** Number of whole-file embeddings, optionally filtered to a model. */
  countFileEmbeddings(model?: string): Promise<number>
  /** Upserts one or more vectors of the given kind. */
  upsert(kind: VectorKind, items: VectorRecord[]): Promise<void>
  /** Deletes vectors of the given kind by id (see `VectorRecord.id`). */
  delete(kind: VectorKind, ids: string[]): Promise<void>
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

/** Arguments for `StorageProfile.writeFileBlob()` — a whole-file blob + embedding. */
export interface WriteFileBlobArgs {
  blobHash: string
  size: number
  path: string
  model: string
  embedding: Embedding
  fileType?: FileCategory
  /** Raw text content for FTS indexing. */
  content?: string
  quantize?: boolean
}

/** Arguments for `StorageProfile.writeBlobRecord()` — a blob + path with no embedding. */
export interface WriteBlobRecordArgs {
  blobHash: string
  size: number
  path: string
  content?: string
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

  /**
   * Writes a blob + its whole-file embedding + its path (+ FTS content, if
   * given) as a single atomic unit. Backends that support transactions
   * (SQLite, Postgres) commit all parts together; this is the cross-store
   * transaction boundary described in docs/storage-backends-plan.md §8.
   */
  writeFileBlob(args: WriteFileBlobArgs): Promise<void>

  /** Writes a blob + its path (+ FTS content) without an embedding, atomically. */
  writeBlobRecord(args: WriteBlobRecordArgs): Promise<void>
}
