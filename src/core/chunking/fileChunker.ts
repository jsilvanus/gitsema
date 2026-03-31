import type { Chunk, Chunker } from './chunker.js'

/**
 * Whole-file chunker — returns the entire content as a single chunk.
 * This is the default strategy and preserves existing indexing behaviour.
 */
export class FileChunker implements Chunker {
  chunk(content: string, _path: string): Chunk[] {
    const lines = content.split('\n')
    return [{ startLine: 1, endLine: lines.length, content }]
  }
}
