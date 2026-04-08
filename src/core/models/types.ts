export type BlobHash = string   // SHA-1 hex
export type CommitHash = string
export type Embedding = number[] | Float32Array

export interface BlobRecord {
  blobHash: BlobHash
  size: number
  indexedAt: number
}

/**
 * Discriminant for SearchResult variants.
 *
 * - `'file'`   — whole-file embedding match (the default)
 * - `'chunk'`  — sub-file chunk match (`chunkId` is set)
 * - `'symbol'` — named symbol match (`symbolId`, `symbolName`, `symbolKind` are set)
 * - `'module'` — directory centroid match (`modulePath` is set; `blobHash` is synthetic)
 */
export type SearchResultKind = 'file' | 'chunk' | 'symbol' | 'module'

export interface SearchResult {
  /**
   * Discriminant field identifying the type of result.
   * - `'file'`   → whole-file match
   * - `'chunk'`  → sub-file chunk match
   * - `'symbol'` → named symbol match
   * - `'module'` → directory centroid match
   *
   * Optional for backward compatibility; set by vectorSearch for all new results.
   */
  kind?: SearchResultKind
  /**
   * For blob/chunk/symbol results: the Git blob OID (SHA-1 hex).
   * For module results: an empty string — use `modulePath` as the module identifier.
   * Never contains synthetic strings like `"module:..."`.
   */
  blobHash: BlobHash
  paths: string[]
  score: number
  firstCommit?: CommitHash
  firstSeen?: number
  /** Database ID of the chunk this result corresponds to (only present for chunk-level results). */
  chunkId?: number
  /** 1-indexed start line of the chunk within its source file. */
  startLine?: number
  /** 1-indexed end line of the chunk within its source file. */
  endLine?: number
  /** Database ID of the symbol this result corresponds to (only present for symbol-level results). */
  symbolId?: number
  /** Name of the symbol (function, class, etc.) — present for symbol-level results. */
  symbolName?: string
  /** Kind of the symbol: 'function' | 'class' | 'method' | 'impl' | 'struct' | 'enum' | 'trait' | 'other'. */
  symbolKind?: string
  /** Detected programming language of the symbol — present for symbol-level results. */
  language?: string
  /**
   * Directory path identifier for module-level results.
   * This is the canonical identifier for module results — use it instead of `blobHash`
   * when `kind === 'module'`.
   */
  modulePath?: string
  /** Cluster label from `cluster_assignments` — populated by `--annotate-clusters` on the search command. */
  clusterLabel?: string
  /** When explain=true, breakdown of score components. */
  signals?: { cosine: number; recency?: number; pathScore?: number; bm25?: number }
}
