export type BlobHash = string   // SHA-1 hex
export type CommitHash = string
export type Embedding = number[]

export interface BlobRecord {
  blobHash: BlobHash
  size: number
  indexedAt: number
}

export interface SearchResult {
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
  /** When present, indicates this result is a module-level (directory) centroid match. */
  modulePath?: string
  /** Cluster label from `cluster_assignments` — populated by `--annotate-clusters` on the search command. */
  clusterLabel?: string
}
