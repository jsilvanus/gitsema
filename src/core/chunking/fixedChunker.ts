import type { Chunk, ChunkOptions, Chunker } from './chunker.js'

const DEFAULT_WINDOW_SIZE = 1500
const DEFAULT_OVERLAP = 200

/**
 * Fixed-size chunker — splits content into overlapping windows of approximately
 * `windowSize` characters with `overlap` characters of shared context between
 * adjacent chunks.  Windows are aligned to line boundaries to avoid cutting
 * mid-line.
 */
export class FixedChunker implements Chunker {
  private readonly windowSize: number
  private readonly overlap: number

  constructor(options: ChunkOptions = {}) {
    this.windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE
    this.overlap = Math.min(options.overlap ?? DEFAULT_OVERLAP, this.windowSize - 1)
  }

  chunk(content: string, _path: string): Chunk[] {
    const lines = content.split('\n')
    if (lines.length === 0) return []

    const chunks: Chunk[] = []
    let startLine = 1  // 1-indexed

    while (startLine <= lines.length) {
      let charCount = 0
      let endLine = startLine - 1

      // Advance endLine until we hit the window size or run out of lines
      while (endLine < lines.length && charCount < this.windowSize) {
        charCount += lines[endLine].length + 1  // +1 for newline
        endLine++
      }

      // endLine is now 1-indexed (inclusive)
      const chunkLines = lines.slice(startLine - 1, endLine)
      chunks.push({
        startLine,
        endLine,
        content: chunkLines.join('\n'),
      })

      if (endLine >= lines.length) break

      // Advance start by (windowSize − overlap) chars, aligned to line boundaries
      const stepTarget = charCount - this.overlap
      let stepped = 0
      let nextStart = startLine
      while (nextStart < endLine && stepped < stepTarget) {
        stepped += lines[nextStart - 1].length + 1
        nextStart++
      }

      // Ensure forward progress
      startLine = Math.max(nextStart, startLine + 1)
    }

    return chunks
  }
}
