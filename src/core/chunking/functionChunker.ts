import type { Chunk, Chunker } from './chunker.js'

/**
 * Regex patterns that identify the start of a top-level function or class
 * declaration for common programming languages.  This is intentionally a
 * heuristic: it covers the majority of real-world code without requiring a
 * full parser / tree-sitter grammar for each language.
 *
 * Matches at the beginning of a line (possibly after leading whitespace for
 * indented top-level declarations in Python).
 */
const FUNCTION_START_RE = /^(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+\w|class\s+\w|\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>)))|(?:^\s*(?:async\s+)?def\s+\w)|(?:^\s*class\s+\w)|(?:^(?:pub\s+)?(?:async\s+)?fn\s+\w)|(?:^(?:public|private|protected|static|final|abstract|synchronized)(?:\s+\w+)*\s+\w+\s*\()/m

/**
 * Minimum number of lines a chunk must contain.  Fragments smaller than this
 * are merged into the previous chunk to avoid tiny, low-value embeddings.
 */
const MIN_CHUNK_LINES = 5

/**
 * Function/class boundary chunker — splits source files on top-level
 * function and class declaration lines using a language-agnostic regex.
 * Supported languages include TypeScript, JavaScript, Python, Rust, Java, Go,
 * C, and C++.
 */
export class FunctionChunker implements Chunker {
  chunk(content: string, _path: string): Chunk[] {
    const lines = content.split('\n')
    if (lines.length === 0) return []

    // Find lines that start a new top-level declaration (1-indexed)
    const splitLines: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (FUNCTION_START_RE.test(lines[i])) {
        splitLines.push(i + 1)  // 1-indexed
      }
    }

    // If no boundaries found, return the whole file as one chunk
    if (splitLines.length === 0) {
      return [{ startLine: 1, endLine: lines.length, content }]
    }

    // Build chunk boundaries: from each split line to the line before the next
    const boundaries: Array<{ start: number; end: number }> = []

    // Content before first declaration (if any)
    if (splitLines[0] > 1) {
      boundaries.push({ start: 1, end: splitLines[0] - 1 })
    }

    for (let i = 0; i < splitLines.length; i++) {
      const start = splitLines[i]
      const end = i + 1 < splitLines.length ? splitLines[i + 1] - 1 : lines.length
      boundaries.push({ start, end })
    }

    // Merge chunks that are too small into their predecessor
    const merged: Array<{ start: number; end: number }> = []
    for (const b of boundaries) {
      if (merged.length > 0 && (b.end - b.start + 1) < MIN_CHUNK_LINES) {
        // Extend the previous chunk to include this fragment
        merged[merged.length - 1].end = b.end
      } else {
        merged.push({ ...b })
      }
    }

    return merged.map(({ start, end }) => ({
      startLine: start,
      endLine: end,
      content: lines.slice(start - 1, end).join('\n'),
    }))
  }
}
