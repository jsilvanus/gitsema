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
  text: string
  childForFieldName(name: string): TSNode | null | undefined
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
// Symbol kind mapping
// ---------------------------------------------------------------------------

/** Maps a tree-sitter node type to a human-readable symbol kind. */
function symbolKindFromNodeType(nodeType: string): string {
  switch (nodeType) {
    case 'function_declaration':
    case 'function_definition':
    case 'function_item':
    case 'function_signature_item':
      return 'function'

    case 'method_declaration':
      return 'method'

    case 'class_declaration':
    case 'class_definition':
      return 'class'

    case 'impl_item':
      return 'impl'

    case 'struct_item':
      return 'struct'

    case 'enum_item':
      return 'enum'

    case 'trait_item':
      return 'trait'

    case 'decorated_definition':
      return 'function'  // Python decorated function/class; resolved below

    case 'export_statement':
      return 'export'  // resolved to inner decl kind below

    case 'lexical_declaration':
    case 'variable_declarator':
      return 'function'  // e.g. const foo = () => {}

    default:
      return 'other'
  }
}

/**
 * Extracts the symbol name and kind from a tree-sitter declaration node.
 * Returns null when the node type is not a recognized top-level declaration.
 */
function extractSymbolInfo(node: TSNode, lang: Language): { name: string; kind: string } | null {
  switch (lang) {
    case 'python': {
      if (node.type === 'decorated_definition') {
        // The actual declaration is the last named child (skipping decorator nodes)
        const inner = node.namedChildren.find(
          (c) => c.type === 'function_definition' || c.type === 'class_definition',
        )
        if (inner) {
          const name = inner.childForFieldName('name')?.text ?? ''
          return { name, kind: inner.type === 'class_definition' ? 'class' : 'function' }
        }
        return null
      }
      if (node.type === 'function_definition') {
        return { name: node.childForFieldName('name')?.text ?? '', kind: 'function' }
      }
      if (node.type === 'class_definition') {
        return { name: node.childForFieldName('name')?.text ?? '', kind: 'class' }
      }
      return null
    }

    case 'go': {
      if (node.type === 'function_declaration') {
        return { name: node.childForFieldName('name')?.text ?? '', kind: 'function' }
      }
      if (node.type === 'method_declaration') {
        return { name: node.childForFieldName('name')?.text ?? '', kind: 'method' }
      }
      return null
    }

    case 'rust': {
      if (node.type === 'function_item') {
        return { name: node.childForFieldName('name')?.text ?? '', kind: 'function' }
      }
      if (node.type === 'impl_item') {
        return { name: node.childForFieldName('type')?.text ?? '', kind: 'impl' }
      }
      if (node.type === 'struct_item') {
        return { name: node.childForFieldName('name')?.text ?? '', kind: 'struct' }
      }
      if (node.type === 'enum_item') {
        return { name: node.childForFieldName('name')?.text ?? '', kind: 'enum' }
      }
      if (node.type === 'trait_item') {
        return { name: node.childForFieldName('name')?.text ?? '', kind: 'trait' }
      }
      return null
    }

    case 'typescript':
    case 'tsx':
    case 'javascript': {
      if (node.type === 'export_statement') {
        // Recurse into the export body to find the inner declaration
        const body = node.namedChildren[0]
        if (body) return extractSymbolInfo(body, lang)
        return null
      }
      if (node.type === 'function_declaration') {
        return { name: node.childForFieldName('name')?.text ?? '', kind: 'function' }
      }
      if (node.type === 'class_declaration') {
        return { name: node.childForFieldName('name')?.text ?? '', kind: 'class' }
      }
      if (node.type === 'lexical_declaration') {
        // e.g. const foo = () => {} or const foo = function() {}
        const declarator = node.namedChildren.find((c) => c.type === 'variable_declarator')
        const name = declarator?.childForFieldName('name')?.text ?? ''
        return { name, kind: 'function' }
      }
      return null
    }

    default:
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
// Declaration info (line + symbol metadata)
// ---------------------------------------------------------------------------

/** Parsed information about a top-level declaration boundary. */
export interface DeclarationInfo {
  /** 1-indexed start line of the declaration. */
  startLine: number
  /** Extracted symbol name, if available. */
  symbolName?: string
  /** Symbol kind: 'function' | 'class' | 'method' | 'impl' | 'struct' | 'enum' | 'trait' | 'other'. */
  symbolKind?: string
}

// ---------------------------------------------------------------------------
// Tree-sitter-based declaration extraction
// ---------------------------------------------------------------------------

/**
 * Uses tree-sitter to extract the 1-indexed start lines of top-level
 * declarations in `content`, together with each declaration's symbol name and
 * kind.  Returns null when tree-sitter is unavailable or parsing fails,
 * signalling the caller to fall back to regex.
 */
function extractDeclarationsWithTreeSitter(content: string, lang: Language): DeclarationInfo[] | null {
  const grammar = getGrammar(lang)
  if (!grammar) return null

  let tree: { rootNode: TSNode }
  try {
    tree = grammar.parse(content)
  } catch {
    return null
  }

  const declarations: DeclarationInfo[] = []
  for (const child of tree.rootNode.namedChildren) {
    if (isTopLevelDecl(child.type, lang)) {
      const symbolInfo = extractSymbolInfo(child, lang)
      declarations.push({
        startLine: child.startPosition.row + 1,  // 1-indexed
        symbolName: symbolInfo?.name || undefined,
        symbolKind: symbolInfo?.kind || undefined,
      })
    }
  }

  return declarations
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
 * Regex-based fallback that returns declaration info (1-indexed start line +
 * symbol name/kind extracted by simple heuristics).
 * For Python, decorators immediately preceding a def/class are pulled back
 * so they appear in the same chunk as the function they annotate.
 */
function extractDeclarationsWithRegex(lines: string[], lang: Language): DeclarationInfo[] {
  const splitRe = getSplitPattern(lang)
  let declarations: DeclarationInfo[] = []

  for (let i = 0; i < lines.length; i++) {
    if (splitRe.test(lines[i])) {
      const symbolInfo = extractSymbolNameFromLine(lines[i], lang)
      declarations.push({
        startLine: i + 1,  // 1-indexed
        symbolName: symbolInfo?.name,
        symbolKind: symbolInfo?.kind,
      })
    }
  }

  if (lang === 'python' && declarations.length > 0) {
    const adjusted: DeclarationInfo[] = []
    for (const decl of declarations) {
      let start = decl.startLine
      let prevIdx = start - 2  // 0-indexed
      while (prevIdx >= 0 && /^\s*@/.test(lines[prevIdx])) {
        start--
        prevIdx--
      }
      adjusted.push({ ...decl, startLine: start })
    }
    // Deduplicate and sort (two functions with adjacent decorators collapsing)
    const seen = new Set<number>()
    declarations = adjusted.filter((d) => {
      if (seen.has(d.startLine)) return false
      seen.add(d.startLine)
      return true
    }).sort((a, b) => a.startLine - b.startLine)
  }

  return declarations
}

// ---------------------------------------------------------------------------
// Regex-based symbol name extraction heuristics
// ---------------------------------------------------------------------------

interface SymbolInfo { name: string; kind: string }

/** Extracts a symbol name and kind from a single declaration line via regex. */
function extractSymbolNameFromLine(line: string, lang: Language): SymbolInfo | null {
  const trimmed = line.trim()

  if (lang === 'python') {
    let m = trimmed.match(/^(?:async\s+)?def\s+(\w+)/)
    if (m) return { name: m[1], kind: 'function' }
    m = trimmed.match(/^class\s+(\w+)/)
    if (m) return { name: m[1], kind: 'class' }
    return null
  }

  if (lang === 'go') {
    // func (recv *Type) MethodName(...) or func FunctionName(...)
    let m = trimmed.match(/^func\s+\([^)]+\)\s+(\w+)/)
    if (m) return { name: m[1], kind: 'method' }
    m = trimmed.match(/^func\s+(\w+)/)
    if (m) return { name: m[1], kind: 'function' }
    return null
  }

  if (lang === 'rust') {
    let m = trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|const\s+|unsafe\s+)?fn\s+(\w+)/)
    if (m) return { name: m[1], kind: 'function' }
    m = trimmed.match(/^(?:pub\s+)?impl(?:<[^>]+>)?\s+(\w+)/)
    if (m) return { name: m[1], kind: 'impl' }
    m = trimmed.match(/^(?:pub\s+)?struct\s+(\w+)/)
    if (m) return { name: m[1], kind: 'struct' }
    m = trimmed.match(/^(?:pub\s+)?enum\s+(\w+)/)
    if (m) return { name: m[1], kind: 'enum' }
    m = trimmed.match(/^(?:pub\s+)?trait\s+(\w+)/)
    if (m) return { name: m[1], kind: 'trait' }
    return null
  }

  if (lang === 'typescript' || lang === 'tsx' || lang === 'javascript') {
    let m = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/)
    if (m) return { name: m[1], kind: 'function' }
    m = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/)
    if (m) return { name: m[1], kind: 'class' }
    m = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\()/)
    if (m) return { name: m[1], kind: 'function' }
    return null
  }

  if (lang === 'java') {
    const m = trimmed.match(/(?:public|private|protected|static|final|abstract|override|virtual)(?:\s+\w+)*\s+(\w+)\s*\(/)
    if (m) return { name: m[1], kind: 'function' }
    return null
  }

  return null
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
    // tree-sitter returns no declarations (e.g. grammar mismatch).
    let declarations = extractDeclarationsWithTreeSitter(content, lang)

    // Use regex if tree-sitter is unavailable or returned no declarations.
    // A null result means tree-sitter couldn't load or parse; an empty array
    // from tree-sitter on a multi-line file means no recognised declarations were
    // found — the regex fallback may still find boundaries (e.g. for unknown
    // language extensions where the grammar is not installed).
    if (declarations === null || declarations.length === 0) {
      declarations = extractDeclarationsWithRegex(lines, lang)
    }

    // If no boundaries found, return the whole file as one chunk
    if (declarations.length === 0) {
      return [{ startLine: 1, endLine: lines.length, content }]
    }

    // Build chunk boundaries: from each declaration start to the line before the next
    const boundaries: Array<{ start: number; end: number; symbolName?: string; symbolKind?: string }> = []

    // Content before first declaration (if any) — no symbol metadata
    if (declarations[0].startLine > 1) {
      boundaries.push({ start: 1, end: declarations[0].startLine - 1 })
    }

    for (let i = 0; i < declarations.length; i++) {
      const { startLine, symbolName, symbolKind } = declarations[i]
      const end = i + 1 < declarations.length ? declarations[i + 1].startLine - 1 : lines.length
      boundaries.push({ start: startLine, end, symbolName, symbolKind })
    }

    // Merge chunks that are too small into their predecessor
    const merged: Array<{ start: number; end: number; symbolName?: string; symbolKind?: string }> = []
    for (const b of boundaries) {
      if (merged.length > 0 && (b.end - b.start + 1) < MIN_CHUNK_LINES) {
        const prev = merged[merged.length - 1]
        prev.end = b.end
        // If the predecessor is a preamble (no symbol) and the small chunk being
        // merged carries a symbol, propagate the symbol to the merged chunk so
        // that symbol-level search can still find the named declaration.
        if (!prev.symbolName && b.symbolName) {
          prev.symbolName = b.symbolName
          prev.symbolKind = b.symbolKind
        }
      } else {
        merged.push({ ...b })
      }
    }

    return merged.map(({ start, end, symbolName, symbolKind }) => ({
      startLine: start,
      endLine: end,
      content: lines.slice(start - 1, end).join('\n'),
      symbolName,
      symbolKind,
    }))
  }
}
