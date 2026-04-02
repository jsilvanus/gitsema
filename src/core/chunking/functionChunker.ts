import type { Chunk, Chunker } from './chunker.js'

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

type Language = 'python' | 'go' | 'rust' | 'typescript' | 'java' | 'other'

function detectLanguage(path: string): Language {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'py': case 'pyi': return 'python'
    case 'go': return 'go'
    case 'rs': return 'rust'
    case 'ts': case 'tsx': case 'js': case 'jsx': case 'mjs': case 'cjs': return 'typescript'
    case 'java': case 'cs': case 'kt': case 'scala': return 'java'
    default: return 'other'
  }
}

// ---------------------------------------------------------------------------
// Language-specific split patterns
// ---------------------------------------------------------------------------

/**
 * Python: `def`, `async def`, and `class` declarations (possibly indented for
 * nested classes).  Decorator lines (`@...`) are handled in a post-processing
 * step so they are included in the same chunk as the function they annotate.
 */
const PYTHON_SPLIT_RE = /^\s*(?:(?:async\s+)?def\s+\w|class\s+\w)/

/**
 * Go: top-level `func` declarations (both standalone functions and methods
 * with receiver types, e.g. `func (r *Receiver) Method(...)`).
 */
const GO_SPLIT_RE = /^func\s+/

/**
 * Rust: top-level `fn` declarations with optional visibility/async/const/unsafe
 * modifiers, and `impl` blocks (including generic ones like `impl<T> Trait for Type`).
 */
const RUST_SPLIT_RE = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|const\s+|unsafe\s+)?(?:fn\s+\w|impl(?:\s|\s*<))/

/**
 * TypeScript / JavaScript: top-level `function` and `class` declarations,
 * and arrow-function or function-expression assignments (including `export`,
 * `default`, and `async` variants).
 */
const TS_SPLIT_RE = /^(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+\w|class\s+\w|\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>)))/

/**
 * Java / C# / Kotlin: access-modifier-qualified method or constructor
 * declarations.
 */
const JAVA_SPLIT_RE = /^(?:public|private|protected|internal|static|final|abstract|override|virtual|synchronized)(?:\s+\w+)*\s+\w+\s*\(/

/**
 * Generic fallback that covers the union of all language-specific patterns.
 * Used for files with an unknown or unrecognised extension.
 */
const DEFAULT_SPLIT_RE = /^(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+\w|class\s+\w|\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>)))|(?:^\s*(?:async\s+)?def\s+\w)|(?:^\s*class\s+\w)|(?:^func\s+)|(?:^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|const\s+|unsafe\s+)?(?:fn\s+\w|impl(?:\s|\s*<)))|(?:^(?:pub|private|protected|static|final|abstract|synchronized)(?:\s+\w+)*\s+\w+\s*\()/

function getSplitPattern(lang: Language): RegExp {
  switch (lang) {
    case 'python':     return PYTHON_SPLIT_RE
    case 'go':         return GO_SPLIT_RE
    case 'rust':       return RUST_SPLIT_RE
    case 'typescript': return TS_SPLIT_RE
    case 'java':       return JAVA_SPLIT_RE
    default:           return DEFAULT_SPLIT_RE
  }
}

// ---------------------------------------------------------------------------
// Chunker
// ---------------------------------------------------------------------------

/**
 * Minimum number of lines a chunk must contain.  Fragments smaller than this
 * are merged into the previous chunk to avoid tiny, low-value embeddings.
 */
const MIN_CHUNK_LINES = 5

/**
 * Language-aware function/class boundary chunker.
 *
 * Splits source files on top-level function and class declaration lines using
 * language-specific regex patterns.  The file extension is used to select the
 * best-fit pattern set; an unrecognised extension falls back to a broad
 * combined pattern that covers TypeScript/JavaScript, Python, Rust, Go, Java,
 * and C#.
 *
 * **Python decorator handling:** decorator lines (`@...`) immediately
 * preceding a `def` or `class` are pulled into the same chunk as the function
 * they annotate, so the embedding captures the full declaration context.
 *
 * Supported languages and their detected extensions:
 * - TypeScript / JavaScript: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`
 * - Python: `.py`, `.pyi`
 * - Go: `.go`
 * - Rust: `.rs`
 * - Java / C# / Kotlin / Scala: `.java`, `.cs`, `.kt`, `.scala`
 * - Everything else: combined fallback pattern
 */
export class FunctionChunker implements Chunker {
  chunk(content: string, path: string): Chunk[] {
    const lines = content.split('\n')
    if (lines.length === 0) return []

    const lang = detectLanguage(path)
    const splitRe = getSplitPattern(lang)

    // Find lines that start a new top-level declaration (1-indexed)
    let splitLines: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (splitRe.test(lines[i])) {
        splitLines.push(i + 1)  // 1-indexed
      }
    }

    // Python decorator handling: walk backwards from each split line to include
    // any immediately preceding `@...` decorator lines in the same chunk.
    if (lang === 'python' && splitLines.length > 0) {
      const adjusted: number[] = []
      for (const splitLine of splitLines) {
        let start = splitLine
        // lines array is 0-indexed; splitLine is 1-indexed
        let prevIdx = start - 2  // line before splitLine, 0-indexed
        while (prevIdx >= 0 && /^\s*@/.test(lines[prevIdx])) {
          start--
          prevIdx--
        }
        adjusted.push(start)
      }
      // Deduplicate and sort in case two adjusted lines collapsed onto the same position
      splitLines = [...new Set(adjusted)].sort((a, b) => a - b)
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
