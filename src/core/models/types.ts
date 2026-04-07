export type BlobHash = string   // SHA-1 hex
export type CommitHash = string
export type Embedding = number[] | Float32Array

export interface BlobRecord {
  blobHash: BlobHash
  size: number
  indexedAt: number
}

export interface SearchResult {
  /**
   * For blob/chunk/symbol results: the Git blob OID (SHA-1 hex).
   * For module results: an empty string — use `modulePath` as the module identifier.
   * Never contains synthetic strings like `"module:..."`.
   */
  blobHash: BlobHash
  /**
   * Discriminates the result kind:
   *   - 'blob'   — whole-file embedding match
   *   - 'chunk'  — sub-file fixed/function chunk match
   *   - 'symbol' — named declaration (function/class/etc.) match
   *   - 'module' — directory-level centroid match (see `modulePath`)
   * Defaults to 'blob' when not explicitly set (backward compat with older code paths).
   */
  kind?: 'blob' | 'chunk' | 'symbol' | 'module'
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
