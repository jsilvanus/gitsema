import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getActiveSession } from '../db/sqlite.js'
import { embeddings, paths, commits, symbols, symbolEmbeddings } from '../db/schema.js'
import { inArray, eq } from 'drizzle-orm'
import { cosineSimilarity, getBranchBlobHashSet } from './vectorSearch.js'
import { getFirstSeenMap } from './timeSearch.js'
import type { EmbeddingProvider } from '../embedding/provider.js'
import { FunctionChunker } from '../chunking/functionChunker.js'
import { FixedChunker } from '../chunking/fixedChunker.js'
import type { Chunk } from '../chunking/chunker.js'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single nearest-neighbor result for a logical block. */
export interface SemanticBlameNeighbor {
  blobHash: string
  /** All known file paths for this blob. */
  paths: string[]
  /** Cosine similarity in [0, 1] — higher is more semantically similar. */
  similarity: number
  /** Hash of the earliest commit that introduced this blob, or null if unknown. */
  commitHash: string | null
  /** Unix epoch (seconds) of the earliest commit, or null if unknown. */
  timestamp: number | null
  /** First line of the commit message, or null. */
  message: string | null
  /** Author name and email from the commit, or null. */
  author: string | null
  /** Symbol name, present when --level symbol is used. */
  symbolName?: string
  /** Symbol kind (e.g. function, class), present when --level symbol is used. */
  symbolKind?: string
}

/** Semantic blame result for one logical block of the file. */
export interface SemanticBlameEntry {
  /** 1-indexed start line of this logical block. */
  startLine: number
  /** 1-indexed end line of this logical block. */
  endLine: number
  /** Short label extracted from the block's first declaration line. */
  label: string
  /** Nearest-neighbor historical blobs sorted by similarity descending. */
  neighbors: SemanticBlameNeighbor[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deserializes a Float32Array stored as a Buffer back to a number[]. */
function bufferToEmbedding(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f32)
}

/**
 * Extracts a concise human-readable label from the first non-empty line of a
 * block.  Recognises common declaration keywords for TypeScript/JavaScript,
 * Python, Go, and Rust; falls back to the first 60 characters of the line.
 */
export function extractBlockLabel(blockContent: string): string {
  const firstLine = blockContent.split('\n').find((l) => l.trim().length > 0) ?? ''
  const t = firstLine.trim()

  // Python decorator — show as-is
  if (t.startsWith('@')) return t.slice(0, 60)

  // Python def / async def / class
  const pyDef = t.match(/^(?:async\s+)?def\s+(\w+)/)
  if (pyDef) return `def ${pyDef[1]}`
  const pyClass = t.match(/^class\s+(\w+)/)
  if (pyClass) return `class ${pyClass[1]}`

  // Go func (including methods: `func (r *Receiver) Method(...)`)
  const goFunc = t.match(/^func\s+(?:\([^)]*\)\s+)?(\w+)/)
  if (goFunc) return `func ${goFunc[1]}`

  // Rust fn / impl
  const rsFn = t.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|const\s+|unsafe\s+)?fn\s+(\w+)/)
  if (rsFn) return `fn ${rsFn[1]}`
  const rsImpl = t.match(/^(?:pub\s+)?impl(?:\s+\w|\s*<)/)
  if (rsImpl) return t.slice(0, 60)

  // TypeScript / JavaScript function / class
  const tsFn = t.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/)
  if (tsFn) return `function ${tsFn[1]}`
  const tsClass = t.match(/^(?:export\s+)?(?:default\s+)?class\s+(\w+)/)
  if (tsClass) return `class ${tsClass[1]}`
  const tsArrow = t.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/)
  if (tsArrow) return `const ${tsArrow[1]}`

  // Java / C# method declaration
  const javaMethod = t.match(/(?:public|private|protected)\s+(?:\w+\s+)*(\w+)\s*\(/)
  if (javaMethod) return `${javaMethod[1]}()`

  // Fallback
  return t.slice(0, 60)
}

/**
 * Fetches the author name and email for a given commit hash via `git log`.
 * Returns `null` when the commit is not found or git is unavailable.
 */
async function getCommitAuthor(commitHash: string, repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-1', '--format=%an <%ae>', commitHash],
      { cwd: repoPath },
    )
    const author = stdout.trim()
    return author.length > 0 ? author : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Computes a semantic blame for the given file content.
 *
 * The file is split into logical blocks using the `FunctionChunker` (which
 * uses language-specific patterns based on the file extension).  When the
 * chunker returns a single whole-file chunk and the file is large enough to
 * warrant finer granularity, a `FixedChunker` is used as a fallback.
 *
 * For each block the function:
 *  1. Embeds the block content with `provider`.
 *  2. Scores all stored blob embeddings by cosine similarity.
 *  3. Returns the top-`topK` nearest neighbors with commit metadata.
 *
 * @param filePath  - Path used for language detection and display (relative to repoPath).
 * @param content   - File content to analyse.
 * @param provider  - Embedding provider used to embed each block.
 * @param opts.topK      - Number of nearest neighbors per block (default 3).
 * @param opts.repoPath  - Working directory for `git log` author lookups (default '.').
 */
export async function computeSemanticBlame(
  filePath: string,
  content: string,
  provider: EmbeddingProvider,
  opts: { topK?: number; searchSymbols?: boolean; repoPath?: string; branch?: string } = {},
): Promise<SemanticBlameEntry[]> {
  const { topK = 3, searchSymbols = false, repoPath = '.', branch } = opts
  const { db } = getActiveSession()

  // --- Chunk the file ---
  const chunker = new FunctionChunker()
  let chunks: Chunk[] = chunker.chunk(content, filePath)

  // Fall back to fixed windows when the function chunker yields only a single
  // whole-file chunk and the content is large enough to benefit from splitting.
  if (chunks.length === 1 && content.length > 2000) {
    const fixed = new FixedChunker({ windowSize: 1500, overlap: 200 })
    chunks = fixed.chunk(content, filePath)
  }

  // --- Load all stored embeddings once (file-level or symbol-level) ---
  type StoredVector = { blobHash: string; vec: number[]; symbolName?: string; symbolKind?: string; startLine?: number | null; endLine?: number | null }

  let storedVectors: StoredVector[]

  if (searchSymbols) {
    const symRows = db
      .select({
        blobHash: symbols.blobHash,
        startLine: symbols.startLine,
        endLine: symbols.endLine,
        symbolName: symbols.symbolName,
        symbolKind: symbols.symbolKind,
        vector: symbolEmbeddings.vector,
      })
      .from(symbolEmbeddings)
      .innerJoin(symbols, eq(symbolEmbeddings.symbolId, symbols.id))
      .all()
    storedVectors = symRows.map((row) => ({
      blobHash: row.blobHash,
      vec: bufferToEmbedding(row.vector as Buffer),
      symbolName: row.symbolName ?? undefined,
      symbolKind: row.symbolKind ?? undefined,
      startLine: row.startLine,
      endLine: row.endLine,
    }))
  } else {
    const allEmbeddings = db
      .select({ blobHash: embeddings.blobHash, vector: embeddings.vector })
      .from(embeddings)
      .all()
    storedVectors = allEmbeddings.map((row) => ({
      blobHash: row.blobHash,
      vec: bufferToEmbedding(row.vector as Buffer),
    }))
  }

  // Apply branch filter when requested
  if (branch) {
    const branchSet = getBranchBlobHashSet(branch)
    storedVectors = storedVectors.filter((v) => branchSet.has(v.blobHash))
  }

  // Early return: no indexed blobs yet
  if (storedVectors.length === 0) {
    return chunks.map((chunk) => ({
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      label: extractBlockLabel(chunk.content),
      neighbors: [],
    }))
  }

  // --- Score each chunk against all stored embeddings ---
  const commitHashesNeeded = new Set<string>()

  const entries: SemanticBlameEntry[] = []

  for (const chunk of chunks) {
    let queryVec: number[]
    try {
      queryVec = await provider.embed(chunk.content)
    } catch {
      // Embedding failure is non-fatal; report the block with no neighbors.
      entries.push({
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        label: extractBlockLabel(chunk.content),
        neighbors: [],
      })
      continue
    }

    // Top-K by cosine similarity
    const scored = storedVectors
      .map((s) => ({ blobHash: s.blobHash, similarity: cosineSimilarity(queryVec, s.vec) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)

    const topHashes = scored.map((s) => s.blobHash)

    // Resolve file paths for the top blobs
    const pathRows = db
      .select({ blobHash: paths.blobHash, path: paths.path })
      .from(paths)
      .where(inArray(paths.blobHash, topHashes))
      .all()

    const pathsByBlob = new Map<string, string[]>()
    for (const row of pathRows) {
      const list = pathsByBlob.get(row.blobHash) ?? []
      list.push(row.path)
      pathsByBlob.set(row.blobHash, list)
    }

    // Resolve earliest commit for each blob
    const firstSeenMap = getFirstSeenMap(topHashes)

    const neighbors: SemanticBlameNeighbor[] = scored.map((s) => {
      const info = firstSeenMap.get(s.blobHash)
      if (info) commitHashesNeeded.add(info.commitHash)
      return {
        blobHash: s.blobHash,
        paths: pathsByBlob.get(s.blobHash) ?? [],
        similarity: s.similarity,
        commitHash: info?.commitHash ?? null,
        timestamp: info?.timestamp ?? null,
        message: null,
        author: null,
        ...(s.symbolName !== undefined ? { symbolName: s.symbolName } : {}),
        ...(s.symbolKind !== undefined ? { symbolKind: s.symbolKind } : {}),
      }
    })

    entries.push({
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      label: extractBlockLabel(chunk.content),
      neighbors,
    })
  }

  // --- Bulk-resolve commit messages from DB ---
  const commitHashes = [...commitHashesNeeded]
  const commitMessageMap = new Map<string, string>()

  const BATCH = 500
  for (let i = 0; i < commitHashes.length; i += BATCH) {
    const batch = commitHashes.slice(i, i + BATCH)
    const rows = db
      .select({ commitHash: commits.commitHash, message: commits.message })
      .from(commits)
      .where(inArray(commits.commitHash, batch))
      .all()
    for (const row of rows) {
      commitMessageMap.set(row.commitHash, row.message)
    }
  }

  // --- Resolve commit authors in parallel via git log ---
  const authorMap = new Map<string, string | null>()
  await Promise.all(
    commitHashes.map(async (hash) => {
      authorMap.set(hash, await getCommitAuthor(hash, repoPath))
    }),
  )

  // --- Fill in message and author on each neighbor ---
  for (const entry of entries) {
    for (const neighbor of entry.neighbors) {
      if (neighbor.commitHash) {
        neighbor.message = commitMessageMap.get(neighbor.commitHash) ?? null
        neighbor.author = authorMap.get(neighbor.commitHash) ?? null
      }
    }
  }

  return entries
}
