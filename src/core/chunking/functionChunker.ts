import type { Chunk, Chunker } from './chunker.js'

// ---------------------------------------------------------------------------
// Tree-sitter lazy loader with graceful fallback
// ---------------------------------------------------------------------------

/**
 * A thin abstraction over the tree-sitter parser state for a single language.
 */
interface TreeSitterGrammar {
  parse(src: string): { rootNode: TSNode }
}

interface TSNode {
  type: string
  startPosition: { row: number; column: number }
  namedChildren: TSNode[]
}

// Dynamically loaded once on first use; stays null if native bindings are
// unavailable in the current environment (e.g. missing C++ toolchain).
let tsAvailable: boolean | null = null
let ParserClass: (new () => {
  setLanguage(lang: unknown): void
  parse(src: string): { rootNode: TSNode }
}) | null = null

/**
 * Attempts to load the `tree-sitter` native module.
 * Returns true if the module loaded successfully.
 */
function loadTreeSitter(): boolean {
  if (tsAvailable !== null) return tsAvailable
  try {
    // Dynamic CJS-style require inside an ESM context — safe for optional
    // native modules that may not be installed / may fail to build.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = require('tree-sitter') as any
    if (mod) {
      ParserClass = mod
      tsAvailable = true
    } else {
      tsAvailable = false
    }
  } catch {
    tsAvailable = false
  }
  return tsAvailable
}

/** Loads a language grammar by CJS module path; returns null on failure. */
function loadGrammar(pkgName: string, exportKey?: string): unknown | null {
  try {
    const mod = require(pkgName) as Record<string, unknown>
    if (exportKey) return mod[exportKey] ?? null
    return mod
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

type Language = 'python' | 'go' | 'rust' | 'typescript' | 'tsx' | 'javascript' | 'java' | 'other'

function detectLanguage(path: string): Language {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'py': case 'pyi': return 'python'
    case 'go': return 'go'
    case 'rs': return 'rust'
    case 'ts': return 'typescript'
    case 'tsx': return 'tsx'
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'javascript'
    case 'java': case 'cs': case 'kt': case 'scala': return 'java'
    default: return 'other'
  }
}

// ---------------------------------------------------------------------------
// Tree-sitter grammar factories (loaded on demand)
// ---------------------------------------------------------------------------

function getGrammar(lang: Language): TreeSitterGrammar | null {
  if (!loadTreeSitter() || !ParserClass) return null

  let language: unknown | null = null
  switch (lang) {
    case 'python':
      language = loadGrammar('tree-sitter-python')
      break
    case 'go':
      language = loadGrammar('tree-sitter-go')
      break
    case 'rust':
      language = loadGrammar('tree-sitter-rust')
      break
    case 'typescript':
      language = loadGrammar('tree-sitter-typescript', 'typescript')
      break
    case 'tsx':
      language = loadGrammar('tree-sitter-typescript', 'tsx')
      break
    case 'javascript':
      language = loadGrammar('tree-sitter-javascript')
      break
    default:
      return null
  }

  if (!language) return null

  try {
    const parser = new ParserClass()
    parser.setLanguage(language)
    return parser as TreeSitterGrammar
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Node types that represent top-level declarations per language
// ---------------------------------------------------------------------------

/** Returns true when `nodeType` is a top-level declaration worth splitting on. */
function isTopLevelDecl(nodeType: string, lang: Language): boolean {
  switch (lang) {
    case 'python':
      return nodeType === 'function_definition'
        || nodeType === 'decorated_definition'
        || nodeType === 'class_definition'

    case 'go':
      return nodeType === 'function_declaration'
        || nodeType === 'method_declaration'

    case 'rust':
      return nodeType === 'function_item'
        || nodeType === 'impl_item'
        || nodeType === 'struct_item'
        || nodeType === 'enum_item'
        || nodeType === 'trait_item'

    case 'typescript':
    case 'tsx':
    case 'javascript':
      // export_statement wraps function/class/const declarations
      return nodeType === 'export_statement'
        || nodeType === 'function_declaration'
        || nodeType === 'class_declaration'
        || nodeType === 'lexical_declaration'  // const foo = () => ...

    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Tree-sitter-based split-line extraction
// ---------------------------------------------------------------------------

/**
 * Uses tree-sitter to extract the 1-indexed start lines of top-level
 * declarations in `content`.  Returns null when tree-sitter is unavailable
 * or parsing fails, signalling the caller to fall back to regex.
 */
function extractSplitLinesWithTreeSitter(content: string, lang: Language): number[] | null {
  const grammar = getGrammar(lang)
  if (!grammar) return null

  let tree: { rootNode: TSNode }
  try {
    tree = grammar.parse(content)
  } catch {
    return null
  }

  const splitLines: number[] = []
  for (const child of tree.rootNode.namedChildren) {
    if (isTopLevelDecl(child.type, lang)) {
      splitLines.push(child.startPosition.row + 1)  // 1-indexed
    }
  }

  return splitLines
}

// ---------------------------------------------------------------------------
// Regex fallback patterns (one per language group)
// ---------------------------------------------------------------------------

const PYTHON_SPLIT_RE = /^\s*(?:(?:async\s+)?def\s+\w|class\s+\w)/
const GO_SPLIT_RE = /^func\s+/
const RUST_SPLIT_RE = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|const\s+|unsafe\s+)?(?:fn\s+\w|impl(?:\s|\s*<))/
const TS_SPLIT_RE = /^(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+\w|class\s+\w|\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>)))/
const JAVA_SPLIT_RE = /^(?:public|private|protected|internal|static|final|abstract|override|virtual|synchronized)(?:\s+\w+)*\s+\w+\s*\(/
const DEFAULT_SPLIT_RE = new RegExp(
  TS_SPLIT_RE.source + '|' +
  PYTHON_SPLIT_RE.source + '|' +
  GO_SPLIT_RE.source + '|' +
  RUST_SPLIT_RE.source + '|' +
  JAVA_SPLIT_RE.source,
)

function getSplitPattern(lang: Language): RegExp {
  switch (lang) {
    case 'python':                     return PYTHON_SPLIT_RE
    case 'go':                         return GO_SPLIT_RE
    case 'rust':                       return RUST_SPLIT_RE
    case 'typescript': case 'tsx':
    case 'javascript':                 return TS_SPLIT_RE
    case 'java':                       return JAVA_SPLIT_RE
    default:                           return DEFAULT_SPLIT_RE
  }
}

/**
 * Regex-based fallback that returns 1-indexed split lines.
 * For Python, decorators immediately preceding a def/class are pulled back
 * so they appear in the same chunk as the function they annotate.
 */
function extractSplitLinesWithRegex(lines: string[], lang: Language): number[] {
  const splitRe = getSplitPattern(lang)
  let splitLines: number[] = []

  for (let i = 0; i < lines.length; i++) {
    if (splitRe.test(lines[i])) {
      splitLines.push(i + 1)  // 1-indexed
    }
  }

  if (lang === 'python' && splitLines.length > 0) {
    const adjusted: number[] = []
    for (const splitLine of splitLines) {
      let start = splitLine
      let prevIdx = start - 2  // 0-indexed
      while (prevIdx >= 0 && /^\s*@/.test(lines[prevIdx])) {
        start--
        prevIdx--
      }
      adjusted.push(start)
    }
    splitLines = [...new Set(adjusted)].sort((a, b) => a - b)
  }

  return splitLines
}

// ---------------------------------------------------------------------------
// Minimum chunk size
// ---------------------------------------------------------------------------

/**
 * Minimum number of lines a chunk must contain.  Fragments smaller than this
 * are merged into the previous chunk to avoid tiny, low-value embeddings.
 */
const MIN_CHUNK_LINES = 5

// ---------------------------------------------------------------------------
// Chunker
// ---------------------------------------------------------------------------

/**
 * Language-aware function/class boundary chunker.
 *
 * Uses **tree-sitter** (when the native bindings are available) to extract
 * top-level declaration boundaries from the source AST.  Falls back to
 * language-specific regex patterns when tree-sitter cannot load or when the
 * grammar for the file's language is not installed.
 *
 * **Supported languages (tree-sitter path):**
 * - TypeScript / TSX: `export_statement`, `function_declaration`, `class_declaration`, `lexical_declaration`
 * - JavaScript:       same as TypeScript
 * - Python:           `function_definition`, `decorated_definition` (decorator lines included), `class_definition`
 * - Go:               `function_declaration`, `method_declaration`
 * - Rust:             `function_item`, `impl_item`, `struct_item`, `enum_item`, `trait_item`
 *
 * **Supported languages (regex fallback):**
 * - All of the above, plus Java / C# / Kotlin / Scala
 *
 * The `tree-sitter` packages must be installed as optional dependencies.
 * When missing the chunker silently falls back to regex — chunk quality
 * degrades gracefully; nothing breaks.
 */
export class FunctionChunker implements Chunker {
  chunk(content: string, path: string): Chunk[] {
    const lines = content.split('\n')
    if (lines.length === 0) return []

    const lang = detectLanguage(path)

    // Try tree-sitter first; fall back to regex when unavailable or when
    // tree-sitter returns no split points (e.g. grammar mismatch).
    let splitLines = extractSplitLinesWithTreeSitter(content, lang)

    // Use regex if tree-sitter is unavailable or returned no split points.
    // A null result means tree-sitter couldn't load or parse; an empty array
    // from tree-sitter on a multi-line file means no recognised declarations were
    // found — the regex fallback may still find boundaries (e.g. for unknown
    // language extensions where the grammar is not installed).
    if (splitLines === null || splitLines.length === 0) {
      splitLines = extractSplitLinesWithRegex(lines, lang)
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
