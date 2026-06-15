/**
 * Tests for per-blob structural extraction (Phase 106, knowledge-graph §3.2/§4).
 *
 * Covers:
 *  1. extractStructuralRefs() golden fixtures for TS/TSX/JS imports/calls/extends/implements
 *  2. Python imports (incl. `from`/aliased/wildcard), calls (incl. `self.method()`), extends
 *  3. Nested-scope enclosingQualifiedName matches Phase 105's qualifiedName
 *  4. Graceful degradation for unsupported languages
 *  5. Schema migration v24 -> v25 (structural_refs table + indexes)
 *  6. storeStructuralRefs() dedup by blob_hash
 */

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { extractStructuralRefs, type StructuralRef } from '../src/core/chunking/structuralRefs.js'
import { extractSymbolMetadata, getGrammar } from '../src/core/chunking/functionChunker.js'
import { runMigrations } from '../src/core/db/migrations/runner.js'
import { openDatabaseAt, withDbSession } from '../src/core/db/sqlite.js'
import { storeStructuralRefs } from '../src/core/indexing/blobStore.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function byKind(refs: StructuralRef[], kind: StructuralRef['refKind']): StructuralRef[] {
  return refs.filter((r) => r.refKind === kind)
}

// extractStructuralRefs()/extractSymbolMetadata() degrade to `[]` when the
// native tree-sitter module is unavailable (e.g. no prebuilt binary for this
// platform/Node combination). Skip the AST-dependent suites in that case
// rather than asserting on empty results.
const treeSitterAvailable = getGrammar('typescript') !== null

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

describe.skipIf(!treeSitterAvailable)('extractStructuralRefs — TypeScript', () => {
  const content = [
    "import Default, { Named, Other as Aliased } from './mod'",
    "import * as ns from './ns-mod'",
    "import './side-effect'",
    "const req = require('./required-mod')",
    '',
    'class Base {}',
    'interface Iface {}',
    '',
    'class Sub extends Base implements Iface {',
    '  method() {',
    '    helper()',
    '    obj.prop.call()',
    '  }',
    '}',
    '',
    'function topLevel() {',
    '  doSomething()',
    '}',
    '',
    'topLevelCall()',
  ].join('\n')

  const refs = extractStructuralRefs(content, 'mod.ts')

  it('extracts default, named, aliased, namespace, and side-effect imports', () => {
    const imports = byKind(refs, 'import')
    expect(imports.some((r) => r.rawTarget === 'Default' && r.targetModule === './mod')).toBe(true)
    expect(imports.some((r) => r.rawTarget === 'Named' && r.targetModule === './mod')).toBe(true)
    // Aliased named imports record the original (exported) name as rawTarget,
    // matching the implementation's "name" field choice for later resolution
    // against the module's exports.
    expect(imports.some((r) => r.rawTarget === 'Other' && r.targetModule === './mod')).toBe(true)
    expect(imports.some((r) => r.rawTarget === '*' && r.targetModule === './ns-mod')).toBe(true)
    expect(imports.some((r) => r.rawTarget === './side-effect' && r.targetModule === './side-effect')).toBe(true)
  })

  it('extracts require() calls as import refs', () => {
    const imports = byKind(refs, 'import')
    expect(imports.some((r) => r.rawTarget === '*' && r.targetModule === './required-mod')).toBe(true)
    // require() itself should not also be recorded as a call
    const calls = byKind(refs, 'call')
    expect(calls.some((r) => r.rawTarget === 'require')).toBe(false)
  })

  it('extracts extends and implements on the class scope', () => {
    const extendsRefs = byKind(refs, 'extends')
    const implementsRefs = byKind(refs, 'implements')
    expect(extendsRefs.some((r) => r.rawTarget === 'Base' && r.enclosingQualifiedName === 'Sub')).toBe(true)
    expect(implementsRefs.some((r) => r.rawTarget === 'Iface' && r.enclosingQualifiedName === 'Sub')).toBe(true)
  })

  it('extracts plain and member-expression calls with the enclosing method scope', () => {
    const calls = byKind(refs, 'call')
    expect(calls.some((r) => r.rawTarget === 'helper' && r.enclosingQualifiedName === 'Sub.method')).toBe(true)
    expect(calls.some((r) => r.rawTarget === 'call' && r.enclosingQualifiedName === 'Sub.method')).toBe(true)
  })

  it('extracts a top-level call with no enclosing scope', () => {
    const calls = byKind(refs, 'call')
    const topCall = calls.find((r) => r.rawTarget === 'topLevelCall')
    expect(topCall).toBeDefined()
    expect(topCall!.enclosingQualifiedName).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// TSX
// ---------------------------------------------------------------------------

describe.skipIf(!treeSitterAvailable)('extractStructuralRefs — TSX', () => {
  it('extracts imports and calls from a function component', () => {
    const content = [
      "import { useState } from 'react'",
      '',
      'export function Greeting(name: string) {',
      '  const [v] = useState(0)',
      '  return <div>{name}{v}</div>',
      '}',
    ].join('\n')
    const refs = extractStructuralRefs(content, 'Greeting.tsx')
    expect(byKind(refs, 'import').some((r) => r.rawTarget === 'useState' && r.targetModule === 'react')).toBe(true)
    expect(byKind(refs, 'call').some((r) => r.rawTarget === 'useState' && r.enclosingQualifiedName === 'Greeting')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// JavaScript
// ---------------------------------------------------------------------------

describe.skipIf(!treeSitterAvailable)('extractStructuralRefs — JavaScript', () => {
  const content = [
    "const { merge } = require('lodash')",
    '',
    'class Widget {',
    '  render() {',
    '    return merge({}, this.props)',
    '  }',
    '}',
    '',
    'const helper = (a, b) => combine(a, b)',
  ].join('\n')

  const refs = extractStructuralRefs(content, 'widget.js')

  it('extracts require() as an import ref', () => {
    expect(byKind(refs, 'import').some((r) => r.rawTarget === '*' && r.targetModule === 'lodash')).toBe(true)
  })

  it('extracts a call inside a method with the method scope', () => {
    expect(byKind(refs, 'call').some((r) => r.rawTarget === 'merge' && r.enclosingQualifiedName === 'Widget.render')).toBe(true)
  })

  it('extracts a call inside a top-level arrow function bound to a const', () => {
    expect(byKind(refs, 'call').some((r) => r.rawTarget === 'combine' && r.enclosingQualifiedName === 'helper')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe.skipIf(!treeSitterAvailable)('extractStructuralRefs — Python', () => {
  const content = [
    'import os',
    'import numpy as np',
    'from collections import OrderedDict, defaultdict as dd',
    'from pkg import *',
    '',
    'class Base:',
    '    pass',
    '',
    'class Sub(Base):',
    '    def method(self):',
    '        self.helper()',
    '        os.getcwd()',
    '',
    'def top_level():',
    '    do_something()',
    '',
    'top_level_call()',
  ].join('\n')

  const refs = extractStructuralRefs(content, 'auth.py')

  it('extracts plain, aliased, from-import, and wildcard imports', () => {
    const imports = byKind(refs, 'import')
    expect(imports.some((r) => r.rawTarget === 'os' && r.targetModule === 'os')).toBe(true)
    // Aliased imports record the original (unaliased) name as rawTarget.
    expect(imports.some((r) => r.rawTarget === 'numpy' && r.targetModule === 'numpy')).toBe(true)
    expect(imports.some((r) => r.rawTarget === 'OrderedDict' && r.targetModule === 'collections')).toBe(true)
    expect(imports.some((r) => r.rawTarget === 'defaultdict' && r.targetModule === 'collections')).toBe(true)
    expect(imports.some((r) => r.rawTarget === '*' && r.targetModule === 'pkg')).toBe(true)
  })

  it('extracts a base class on the class scope', () => {
    expect(byKind(refs, 'extends').some((r) => r.rawTarget === 'Base' && r.enclosingQualifiedName === 'Sub')).toBe(true)
  })

  it('extracts self.method() calls resolved to the method name', () => {
    expect(byKind(refs, 'call').some((r) => r.rawTarget === 'helper' && r.enclosingQualifiedName === 'Sub.method')).toBe(true)
  })

  it('extracts a module-attribute call with the method scope', () => {
    expect(byKind(refs, 'call').some((r) => r.rawTarget === 'getcwd' && r.enclosingQualifiedName === 'Sub.method')).toBe(true)
  })

  it('extracts a top-level call with no enclosing scope', () => {
    const topCall = byKind(refs, 'call').find((r) => r.rawTarget === 'top_level_call')
    expect(topCall).toBeDefined()
    expect(topCall!.enclosingQualifiedName).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Nested scopes match Phase 105's qualifiedName
// ---------------------------------------------------------------------------

describe.skipIf(!treeSitterAvailable)('extractStructuralRefs — enclosingQualifiedName matches Phase 105 qualifiedName', () => {
  it('TS: a call inside a nested method has enclosingQualifiedName equal to the method symbol qualifiedName', () => {
    const content = [
      'class Outer {',
      '  inner() {',
      '    doWork()',
      '  }',
      '}',
    ].join('\n')

    const refs = extractStructuralRefs(content, 'nested.ts')
    const symbols = extractSymbolMetadata(content, 'nested.ts')

    const call = byKind(refs, 'call').find((r) => r.rawTarget === 'doWork')
    const method = symbols.find((s) => s.symbolKind === 'method')

    expect(call).toBeDefined()
    expect(method).toBeDefined()
    expect(call!.enclosingQualifiedName).toBe(method!.qualifiedName)
  })

  it('Python: a call inside a nested method has enclosingQualifiedName equal to the method symbol qualifiedName', () => {
    const content = [
      'class Outer:',
      '    def inner(self):',
      '        do_work()',
    ].join('\n')

    const refs = extractStructuralRefs(content, 'nested.py')
    const symbols = extractSymbolMetadata(content, 'nested.py')

    const call = byKind(refs, 'call').find((r) => r.rawTarget === 'do_work')
    const method = symbols.find((s) => s.symbolKind === 'method')

    expect(call).toBeDefined()
    expect(method).toBeDefined()
    expect(call!.enclosingQualifiedName).toBe(method!.qualifiedName)
  })
})

// ---------------------------------------------------------------------------
// Graceful degradation for unsupported languages
// ---------------------------------------------------------------------------

describe('extractStructuralRefs — unsupported languages', () => {
  it('returns [] for Go', () => {
    const content = 'func Add(a, b int) int {\n  return a + b\n}'
    expect(extractStructuralRefs(content, 'math.go')).toEqual([])
  })

  it('returns [] for Rust', () => {
    const content = 'fn add(a: i32, b: i32) -> i32 {\n  a + b\n}'
    expect(extractStructuralRefs(content, 'math.rs')).toEqual([])
  })

  it('returns [] for plain text', () => {
    expect(extractStructuralRefs('just some prose', 'README.md')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Migration v24 -> v25
// ---------------------------------------------------------------------------

describe('schema migration v24 -> v25 (structural_refs table)', () => {
  it('creates the structural_refs table and its indexes on an existing v24 database', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec(`
        CREATE TABLE blobs (
          blob_hash TEXT PRIMARY KEY,
          size INTEGER NOT NULL,
          indexed_at INTEGER NOT NULL
        );
        CREATE TABLE embeddings (
          blob_hash TEXT NOT NULL,
          model TEXT NOT NULL,
          dimensions INTEGER NOT NULL,
          vector BLOB NOT NULL,
          file_type TEXT,
          PRIMARY KEY (blob_hash, model)
        );
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO meta (key, value) VALUES ('schema_version', '24');
      `)

      runMigrations(sqlite)

      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'structural_refs'")
        .all()
      expect(tables.length).toBe(1)

      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'structural_refs'")
        .all() as Array<{ name: string }>
      const indexNames = indexes.map((i) => i.name)
      expect(indexNames).toContain('idx_structural_refs_blob_hash')
      expect(indexNames).toContain('idx_structural_refs_kind_target')

      const version = sqlite.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string }
      expect(parseInt(version.value, 10)).toBeGreaterThanOrEqual(25)
    } finally {
      sqlite.close()
    }
  })

  it('is idempotent when run twice', () => {
    const sqlite = new Database(':memory:')
    try {
      sqlite.exec(`
        CREATE TABLE blobs (
          blob_hash TEXT PRIMARY KEY,
          size INTEGER NOT NULL,
          indexed_at INTEGER NOT NULL
        );
        CREATE TABLE embeddings (
          blob_hash TEXT NOT NULL,
          model TEXT NOT NULL,
          dimensions INTEGER NOT NULL,
          vector BLOB NOT NULL,
          file_type TEXT,
          PRIMARY KEY (blob_hash, model)
        );
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO meta (key, value) VALUES ('schema_version', '24');
      `)

      runMigrations(sqlite)
      runMigrations(sqlite)

      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'structural_refs'")
        .all()
      expect(tables.length).toBe(1)
    } finally {
      sqlite.close()
    }
  })
})

// ---------------------------------------------------------------------------
// storeStructuralRefs dedup
// ---------------------------------------------------------------------------

describe('storeStructuralRefs', () => {
  it('inserts rows for a blob and skips re-insertion on a second call (dedup by blob_hash)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-structuralrefs-'))
    try {
      const dbPath = join(tmpDir, 'test.db')
      const session = openDatabaseAt(dbPath)

      session.rawDb
        .prepare('INSERT INTO blobs (blob_hash, size, indexed_at) VALUES (?, ?, ?)')
        .run('feedface00feedface00feedface00feedface0', 100, Date.now())

      const refs: StructuralRef[] = [
        { refKind: 'import', rawTarget: 'os', targetModule: 'os', line: 1 },
        { refKind: 'call', rawTarget: 'do_something', line: 5 },
      ]

      await withDbSession(session, async () => {
        storeStructuralRefs('feedface00feedface00feedface00feedface0', refs)
        // Second call should be a no-op (already present for this blob_hash)
        storeStructuralRefs('feedface00feedface00feedface00feedface0', refs)
      })

      const rows = session.rawDb
        .prepare('SELECT * FROM structural_refs WHERE blob_hash = ?')
        .all('feedface00feedface00feedface00feedface0') as Array<Record<string, unknown>>

      expect(rows.length).toBe(2)
      expect(rows.some((r) => r.ref_kind === 'import' && r.raw_target === 'os' && r.target_module === 'os')).toBe(true)
      expect(rows.some((r) => r.ref_kind === 'call' && r.raw_target === 'do_something')).toBe(true)

      session.rawDb.close()
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
