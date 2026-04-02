/**
 * Chunking strategies for splitting blob content into sub-file fragments.
 *
 * - `file`     — whole-file (default, single chunk covering the entire content)
 * - `function` — split on function / class boundaries (regex-based heuristic)
 * - `fixed`    — fixed-size windows with overlap
 */

export type ChunkStrategy = 'file' | 'function' | 'fixed'

/** A sub-file fragment produced by a chunker. Lines are 1-indexed. */
export interface Chunk {
  startLine: number
  endLine: number
  content: string
  /**
   * Name of the declared symbol this chunk represents (function, class, method,
   * impl block, etc.), when extracted from the source AST or via regex heuristics.
   * Present only when using the `function` chunker strategy.
   */
  symbolName?: string
  /**
   * Kind of the declared symbol: `'function'`, `'class'`, `'method'`, `'impl'`,
   * `'struct'`, `'enum'`, `'trait'`, or `'other'`.
   * Present only when using the `function` chunker strategy.
   */
  symbolKind?: string
}

export interface ChunkOptions {
  /** For `fixed` strategy: target chunk size in characters (default 1500). */
  windowSize?: number
  /** For `fixed` strategy: overlap between adjacent windows in characters (default 200). */
  overlap?: number
}

export interface Chunker {
  chunk(content: string, path: string): Chunk[]
}

export { FileChunker } from './fileChunker.js'
export { FixedChunker } from './fixedChunker.js'
export { FunctionChunker } from './functionChunker.js'

import { FileChunker } from './fileChunker.js'
import { FixedChunker } from './fixedChunker.js'
import { FunctionChunker } from './functionChunker.js'

/**
 * Returns a Chunker instance for the given strategy.
 */
export function createChunker(strategy: ChunkStrategy, options: ChunkOptions = {}): Chunker {
  switch (strategy) {
    case 'file':
      return new FileChunker()
    case 'fixed':
      return new FixedChunker(options)
    case 'function':
      return new FunctionChunker()
  }
}
