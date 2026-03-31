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
}
