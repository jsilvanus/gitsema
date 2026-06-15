import {
  detectLanguage, getGrammar, TS_JS_LANGS,
  type Language, type TSNode,
} from './functionChunker.js'

// ---------------------------------------------------------------------------
// Per-blob structural extraction (Phase 106 — knowledge-graph §3.2/§4)
//
// Walks the full AST with the same scope-stack approach as
// `extractSymbolMetadata` (Phase 105) and records raw, unresolved structural
// references: imports, calls, extends/implements heritage. This is a "sites
// only" extraction — no resolution to definitions happens here (Phase 107).
// Supported for TS/TSX/JS/Python only; other languages return `[]`. Returns
// `[]` (never throws) when tree-sitter is unavailable.
// ---------------------------------------------------------------------------

/** A raw structural reference as literally seen by the parser (Phase 106). */
export interface StructuralRef {
  /**
   * Path-free qualified name of the enclosing scope (matches Phase 105's
   * `qualifiedName` for that scope), or `undefined` for file/top-level scope.
   */
  enclosingQualifiedName?: string
  refKind: 'import' | 'call' | 'extends' | 'implements' | 'reference'
  /** Literal text as written: imported name, callee name, base class name, etc. */
  rawTarget: string
  /** For imports: the raw, unresolved module specifier. */
  targetModule?: string
  /** 1-indexed line number. */
  line: number
}

/** Strips a single layer of surrounding quotes from a string literal's text. */
function stripQuotes(text: string): string {
  return text.replace(/^['"`]/, '').replace(/['"`]$/, '')
}

/** Joins the scope stack into a path-free qualified name, or undefined at top level. */
function enclosingName(scopeStack: readonly string[]): string | undefined {
  return scopeStack.length > 0 ? scopeStack.join('.') : undefined
}

/**
 * Returns the "raw target" name for a call/heritage callee expression:
 * the bare identifier, or the rightmost property of a member/attribute
 * expression (`a.b.c` → `c`).
 */
function rightmostName(node: TSNode): string | undefined {
  if (node.type === 'identifier') return node.text
  if (node.type === 'member_expression' || node.type === 'attribute') {
    return node.childForFieldName('property')?.text ?? node.childForFieldName('attribute')?.text
  }
  return undefined
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript extraction (§4.1)
// ---------------------------------------------------------------------------

/** Extracts refs from an `import_statement` node. */
function extractTsImport(node: TSNode, scopeStack: readonly string[], out: StructuralRef[]): void {
  const line = node.startPosition.row + 1
  const enclosing = enclosingName(scopeStack)
  const sourceNode = node.childForFieldName('source')
  const targetModule = sourceNode ? stripQuotes(sourceNode.text) : undefined

  const clause = node.namedChildren.find((c) => c.type === 'import_clause')
  if (!clause) {
    // Side-effect import: `import './polyfills'`
    if (targetModule) {
      out.push({ enclosingQualifiedName: enclosing, refKind: 'import', rawTarget: targetModule, targetModule, line })
    }
    return
  }

  for (const child of clause.namedChildren) {
    switch (child.type) {
      case 'identifier': // default import
        out.push({ enclosingQualifiedName: enclosing, refKind: 'import', rawTarget: child.text, targetModule, line })
        break
      case 'namespace_import': // import * as Name
        out.push({ enclosingQualifiedName: enclosing, refKind: 'import', rawTarget: '*', targetModule, line })
        break
      case 'named_imports':
        for (const spec of child.namedChildren) {
          if (spec.type !== 'import_specifier') continue
          const name = spec.childForFieldName('name')?.text ?? spec.text
          out.push({ enclosingQualifiedName: enclosing, refKind: 'import', rawTarget: name, targetModule, line })
        }
        break
      default:
        break
    }
  }
}

/** Extracts the `extends`/`implements` refs from a `class_heritage` node. */
function extractTsHeritage(heritage: TSNode, classScope: readonly string[], out: StructuralRef[]): void {
  const enclosing = classScope.join('.')
  for (const child of heritage.namedChildren) {
    if (child.type === 'extends_clause') {
      const value = child.childForFieldName('value') ?? child.namedChildren[0]
      if (value) {
        const name = rightmostName(value) ?? value.text
        out.push({ enclosingQualifiedName: enclosing, refKind: 'extends', rawTarget: name, line: child.startPosition.row + 1 })
      }
    } else if (child.type === 'implements_clause') {
      for (const t of child.namedChildren) {
        const name = t.type === 'generic_type' ? (t.childForFieldName('name')?.text ?? t.text) : t.text
        out.push({ enclosingQualifiedName: enclosing, refKind: 'implements', rawTarget: name, line: t.startPosition.row + 1 })
      }
    } else {
      // JS-style: class_heritage directly wraps the superclass expression
      const name = rightmostName(child) ?? child.text
      out.push({ enclosingQualifiedName: enclosing, refKind: 'extends', rawTarget: name, line: child.startPosition.row + 1 })
    }
  }
}

/** True if `node` is the lexical-declaration shape `const foo = (...) => {...}` / `function(){}`. */
function functionLikeValue(node: TSNode | null | undefined): boolean {
  return !!node && (node.type === 'arrow_function' || node.type === 'function_expression' || node.type === 'function')
}

/**
 * Recursively walks one TS/TSX/JS node, recording structural refs and
 * descending into nested scopes (classes, functions, methods) with an
 * updated scope stack.
 */
function walkTsJs(node: TSNode, scopeStack: readonly string[], out: StructuralRef[]): void {
  switch (node.type) {
    case 'import_statement':
      extractTsImport(node, scopeStack, out)
      return

    case 'call_expression': {
      const callee = node.childForFieldName('function')
      const line = node.startPosition.row + 1
      const enclosing = enclosingName(scopeStack)
      if (callee?.type === 'identifier' && callee.text === 'require') {
        const args = node.childForFieldName('arguments')
        const first = args?.namedChildren[0]
        if (first && (first.type === 'string' || first.type === 'template_string')) {
          const targetModule = stripQuotes(first.text)
          out.push({ enclosingQualifiedName: enclosing, refKind: 'import', rawTarget: '*', targetModule, line })
        }
      } else if (callee) {
        const rawTarget = rightmostName(callee)
        if (rawTarget) out.push({ enclosingQualifiedName: enclosing, refKind: 'call', rawTarget, line })
      }
      for (const child of node.namedChildren) walkTsJs(child, scopeStack, out)
      return
    }

    case 'class_declaration': {
      const name = node.childForFieldName('name')?.text ?? ''
      const newScope = [...scopeStack, name]
      const heritage = node.namedChildren.find((c) => c.type === 'class_heritage')
      if (heritage) extractTsHeritage(heritage, newScope, out)
      const body = node.childForFieldName('body')
      if (body) {
        for (const member of body.namedChildren) walkTsJs(member, newScope, out)
      }
      return
    }

    case 'method_definition':
    case 'function_declaration': {
      const name = node.childForFieldName('name')?.text ?? ''
      const newScope = [...scopeStack, name]
      const body = node.childForFieldName('body')
      if (body) walkTsJs(body, newScope, out)
      return
    }

    case 'lexical_declaration': {
      for (const declarator of node.namedChildren) {
        if (declarator.type !== 'variable_declarator') continue
        const name = declarator.childForFieldName('name')?.text ?? ''
        const value = declarator.childForFieldName('value')
        if (functionLikeValue(value)) {
          const newScope = [...scopeStack, name]
          const body = value!.childForFieldName('body')
          if (body) walkTsJs(body, newScope, out)
        } else if (value) {
          walkTsJs(value, scopeStack, out)
        }
      }
      return
    }

    case 'public_field_definition':
    case 'field_definition': {
      const value = node.childForFieldName('value')
      if (functionLikeValue(value)) {
        const name = node.childForFieldName('name')?.text ?? node.childForFieldName('property')?.text ?? ''
        const newScope = [...scopeStack, name]
        const body = value!.childForFieldName('body')
        if (body) walkTsJs(body, newScope, out)
      }
      return
    }

    default:
      for (const child of node.namedChildren) walkTsJs(child, scopeStack, out)
      return
  }
}

// ---------------------------------------------------------------------------
// Python extraction (§4.2)
// ---------------------------------------------------------------------------

/** Extracts refs from an `import_statement` / `import_from_statement` node. */
function extractPyImport(node: TSNode, scopeStack: readonly string[], out: StructuralRef[]): void {
  const line = node.startPosition.row + 1
  const enclosing = enclosingName(scopeStack)

  if (node.type === 'import_statement') {
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name') {
        out.push({ enclosingQualifiedName: enclosing, refKind: 'import', rawTarget: child.text, targetModule: child.text, line })
      } else if (child.type === 'aliased_import') {
        const name = child.childForFieldName('name')?.text ?? ''
        if (name) out.push({ enclosingQualifiedName: enclosing, refKind: 'import', rawTarget: name, targetModule: name, line })
      }
    }
    return
  }

  // import_from_statement: `from <module_name> import a, b as c, *`
  const moduleNode = node.childForFieldName('module_name')
  const targetModule = moduleNode?.text
  for (const child of node.namedChildren) {
    if (child === moduleNode) continue
    if (child.type === 'dotted_name') {
      out.push({ enclosingQualifiedName: enclosing, refKind: 'import', rawTarget: child.text, targetModule, line })
    } else if (child.type === 'aliased_import') {
      const name = child.childForFieldName('name')?.text ?? ''
      if (name) out.push({ enclosingQualifiedName: enclosing, refKind: 'import', rawTarget: name, targetModule, line })
    } else if (child.type === 'wildcard_import') {
      out.push({ enclosingQualifiedName: enclosing, refKind: 'import', rawTarget: '*', targetModule, line })
    }
  }
}

/** Extracts `extends` refs from a `class_definition`'s base-class argument list. */
function extractPyBaseClasses(node: TSNode, classScope: readonly string[], out: StructuralRef[]): void {
  const superclasses = node.childForFieldName('superclasses')
  if (!superclasses) return
  const enclosing = classScope.join('.')
  for (const arg of superclasses.namedChildren) {
    if (arg.type === 'keyword_argument') continue // e.g. metaclass=...
    const name = rightmostName(arg)
    if (name) out.push({ enclosingQualifiedName: enclosing, refKind: 'extends', rawTarget: name, line: arg.startPosition.row + 1 })
  }
}

/**
 * Recursively walks one Python node, recording structural refs and
 * descending into nested scopes (classes, functions) with an updated scope
 * stack. `self.method()` calls resolve `rawTarget` to `method`.
 */
function walkPython(node: TSNode, scopeStack: readonly string[], out: StructuralRef[]): void {
  switch (node.type) {
    case 'import_statement':
    case 'import_from_statement':
      extractPyImport(node, scopeStack, out)
      return

    case 'call': {
      const callee = node.childForFieldName('function')
      if (callee) {
        const rawTarget = rightmostName(callee)
        if (rawTarget) {
          out.push({ enclosingQualifiedName: enclosingName(scopeStack), refKind: 'call', rawTarget, line: node.startPosition.row + 1 })
        }
      }
      for (const child of node.namedChildren) walkPython(child, scopeStack, out)
      return
    }

    case 'decorated_definition':
      for (const child of node.namedChildren) walkPython(child, scopeStack, out)
      return

    case 'class_definition': {
      const name = node.childForFieldName('name')?.text ?? ''
      const newScope = [...scopeStack, name]
      extractPyBaseClasses(node, newScope, out)
      const body = node.childForFieldName('body')
      if (body) {
        for (const member of body.namedChildren) walkPython(member, newScope, out)
      }
      return
    }

    case 'function_definition': {
      const name = node.childForFieldName('name')?.text ?? ''
      const newScope = [...scopeStack, name]
      const body = node.childForFieldName('body')
      if (body) walkPython(body, newScope, out)
      return
    }

    default:
      for (const child of node.namedChildren) walkPython(child, scopeStack, out)
      return
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Extracts raw, unresolved structural references (imports, calls,
 * extends/implements heritage) from `content`. Supported for TypeScript,
 * TSX, JavaScript, and Python only (knowledge-graph §4.1/§4.2); all other
 * languages return `[]`. Returns `[]` (never throws) when tree-sitter is
 * unavailable or parsing fails.
 */
export function extractStructuralRefs(content: string, path: string): StructuralRef[] {
  const lang: Language = detectLanguage(path)
  if (!TS_JS_LANGS.has(lang) && lang !== 'python') return []

  const grammar = getGrammar(lang)
  if (!grammar) return []

  let tree: { rootNode: TSNode }
  try {
    tree = grammar.parse(content)
  } catch {
    return []
  }

  const out: StructuralRef[] = []
  const walk = TS_JS_LANGS.has(lang) ? walkTsJs : walkPython
  for (const child of tree.rootNode.namedChildren) {
    walk(child, [], out)
  }
  return out
}
