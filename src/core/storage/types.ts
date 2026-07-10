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

/**
 * Typed edge kinds in the structural graph (Phase 107, knowledge-graph §5).
 * `similar_to` is reserved for a later phase (semantic-neighbor edges) and is
 * never written by `gitsema graph build`.
 */
export type EdgeType =
  | 'contains'
  | 'defines'
  | 'imports'
  | 'calls'
  | 'extends'
  | 'implements'
  | 'references'
  | 'co_change'
  | 'similar_to'

/** A node in the structural graph (Phase 107, knowledge-graph §2.3/§3.3). */
export interface GraphNodeRecord {
  /** `file:<path>` | `symbol:<path>#<qualifiedName>#<signatureHash>` | `external:<name>`. */
  nodeKey: string
  /** `file` | `function` | `class` | `method` | ... | `external`. */
  kind: string
  displayName: string
  /** File the node lives at; undefined for external nodes. */
  path?: string
  repoId?: string
  /** Most-recent occurrence's blob hash; undefined for file aggregates / external nodes. */
  currentBlobHash?: string
  isExternal?: boolean
}

/** A typed edge between two `graph_nodes.node_key` values (Phase 107). */
export interface GraphEdgeRecord {
  srcKey: string
  dstKey: string
  edgeType: EdgeType
  /** observed_count or co-change strength. Defaults to 1. */
  weight?: number
  /** Resolution confidence 0..1 (knowledge-graph §4). Defaults to 1. */
  confidence?: number
  firstSeenCommit?: string
  lastSeenCommit?: string
  observedCount?: number
}

/**
 * Default/maximum traversal depth for `GraphStore` traversal primitives
 * (Phase 108, knowledge-graph §6). Capped to bound recursive-CTE cost.
 */
export const MAX_GRAPH_TRAVERSAL_DEPTH = 3

/**
 * Upper bound for a network-supplied `depth` request parameter on the graph
 * closure/blast-radius tools (Phase 152 / review11 §3.3). These tools accept a
 * caller-chosen depth ("default: unlimited"); this cap is a generous but finite
 * ceiling so a network client can't request a pathologically deep traversal.
 * Deliberately far above `MAX_GRAPH_TRAVERSAL_DEPTH` — real dependency closures
 * never approach it, so it never rejects a legitimate value.
 */
export const MAX_GRAPH_DEPTH_REQUEST = 64

/** A node reached during a `GraphStore` traversal (Phase 108, knowledge-graph §6). */
export interface GraphHit {
  nodeKey: string
  displayName: string
  kind: string
  /** Number of hops from the traversal's starting node (>= 1). */
  depth: number
  /** The edge type of the (shortest) hop that reached this node, if known. */
  edgeType?: EdgeType
}

/** One hop in a `GraphPath` (Phase 108, knowledge-graph §6). */
export interface GraphPathHop {
  nodeKey: string
  displayName: string
  edgeType: EdgeType
  /** True if this hop traverses an edge against its stored src->dst direction. */
  reversed: boolean
}

/** A shortest typed path between two graph nodes (Phase 108, knowledge-graph §6). */
export interface GraphPath {
  from: string
  to: string
  /** Hops from `from` to `to`, in order. Empty if `from === to`. */
  hops: GraphPathHop[]
}

/** A node-induced subgraph (Phase 108, knowledge-graph §6). */
export interface GraphSubgraph {
  nodes: GraphNodeRecord[]
  edges: GraphEdgeRecord[]
}

/**
 * Storage for the recomputable structural graph (Phase 107, knowledge-graph
 * §3.3/§6). `gitsema graph build` truncates and rebuilds nodes/edges wholesale
 * (like `blob_clusters`); read methods back the early `co-change`/`deps`/
 * `cycles` commands plus the Phase 108 traversal primitives.
 *
 * Relational-only (review9 §4): the Qdrant profile's `GraphStore` throws on
 * every method — graph queries require a relational backend.
 */
export interface GraphStore {
  /** Atomically replaces all nodes and edges (truncate-and-rebuild). */
  replaceAll(nodes: GraphNodeRecord[], edges: GraphEdgeRecord[]): Promise<void>
  /** Total node / edge counts, e.g. for `gitsema graph build` summaries. */
  countNodes(): Promise<number>
  countEdges(): Promise<number>
  /** A single node by key, or undefined if it doesn't exist. */
  getNode(nodeKey: string): Promise<GraphNodeRecord | undefined>
  /** All nodes (small graphs only — used by `cycles`/`deps`). */
  allNodes(): Promise<GraphNodeRecord[]>
  /** Nodes whose `displayName` (qualified name) exactly matches, via an indexed lookup (review10 §2.2). */
  findByDisplayName(displayName: string): Promise<GraphNodeRecord[]>
  /** All edges, optionally filtered to the given edge types. */
  allEdges(edgeTypes?: EdgeType[]): Promise<GraphEdgeRecord[]>
  /** Edges touching `nodeKey`, optionally filtered by direction and edge types. */
  edgesFor(nodeKey: string, opts?: { edgeTypes?: EdgeType[]; direction?: 'out' | 'in' | 'both' }): Promise<GraphEdgeRecord[]>

  /**
   * Typed neighborhood of `key` via recursive traversal (Phase 108,
   * knowledge-graph §6). `direction` defaults to `'both'`; `depth` defaults
   * to 1 and is capped at `MAX_GRAPH_TRAVERSAL_DEPTH`.
   */
  neighbors(key: string, opts?: { edgeTypes?: EdgeType[]; direction?: 'out' | 'in' | 'both'; depth?: number }): Promise<GraphHit[]>
  /** Reverse `calls` traversal — who (transitively) calls `key`. Depth capped at `MAX_GRAPH_TRAVERSAL_DEPTH` (default). */
  callers(key: string, depth?: number): Promise<GraphHit[]>
  /** Forward `calls` traversal — what `key` (transitively) calls. Depth capped at `MAX_GRAPH_TRAVERSAL_DEPTH` (default). */
  callees(key: string, depth?: number): Promise<GraphHit[]>
  /** Shortest typed path from `from` to `to` (any edge type/direction), or null if unreachable within `MAX_GRAPH_TRAVERSAL_DEPTH`. */
  path(from: string, to: string): Promise<GraphPath | null>
  /** The node-induced subgraph within `depth` hops of `seed` (both directions, all edge types). `depth` capped at `MAX_GRAPH_TRAVERSAL_DEPTH`. */
  subgraph(seed: string, depth?: number): Promise<GraphSubgraph>
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
  /** Structural graph store (Phase 107). Throws on Qdrant profiles — see `GraphStore`. */
  readonly graph: GraphStore

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
