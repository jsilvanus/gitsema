import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { extractSymbolMetadata, type SymbolMetadata } from '../src/core/chunking/functionChunker.js'
import { runMigrations } from '../src/core/db/migrations/runner.js'

function sha1_12(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 12)
}

function byQualifiedName(symbols: SymbolMetadata[], qualifiedName: string): SymbolMetadata | undefined {
  return symbols.find((s) => s.qualifiedName === qualifiedName)
}

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

describe('extractSymbolMetadata — TypeScript', () => {
  const content = [
    'export class Auth {',
    '  validateToken(token: string): boolean {',
    '    return token.length > 0',
    '  }',
    '}',
    '',
    'function topLevel(a: number, b: string) {',
    '  return a',
    '}',
  ].join('\n')

  const symbols = extractSymbolMetadata(content, 'auth.ts')

  it('extracts the class with no parent and no signature', () => {
    const cls = byQualifiedName(symbols, 'Auth')
    expect(cls).toBeDefined()
    expect(cls!.symbolKind).toBe('class')
    expect(cls!.parentQualifiedName).toBeUndefined()
    expect(cls!.signature).toBeUndefined()
  })

  it('extracts a nested method with a path-free qualifiedName and parent scope', () => {
    const method = byQualifiedName(symbols, 'Auth.validateToken')
    expect(method).toBeDefined()
    expect(method!.symbolKind).toBe('method')
    expect(method!.parentQualifiedName).toBe('Auth')
    expect(method!.signature).toBe('(token:string)')
    expect(method!.signatureHash).toBe(sha1_12('(token:string)'))
  })

  it('extracts a top-level function with no parent scope', () => {
    const fn = byQualifiedName(symbols, 'topLevel')
    expect(fn).toBeDefined()
    expect(fn!.symbolKind).toBe('function')
    expect(fn!.parentQualifiedName).toBeUndefined()
    expect(fn!.signature).toBe('(a:number,b:string)')
    expect(fn!.signatureHash).toBe(sha1_12('(a:number,b:string)'))
  })

  it('distinguishes overloaded methods by signatureHash while sharing qualifiedName', () => {
    const overloadContent = [
      'class Repo {',
      '  find(id: number): string {',
      '    return String(id)',
      '  }',
      '  find(id: string): string {',
      '    return id',
      '  }',
      '}',
    ].join('\n')
    const overloadSymbols = extractSymbolMetadata(overloadContent, 'repo.ts')
    const finds = overloadSymbols.filter((s) => s.qualifiedName === 'Repo.find')
    expect(finds.length).toBe(2)
    expect(finds[0].signature).not.toBe(finds[1].signature)
    expect(finds[0].signatureHash).not.toBe(finds[1].signatureHash)
    for (const f of finds) expect(f.parentQualifiedName).toBe('Repo')
  })
})

// ---------------------------------------------------------------------------
// TSX
// ---------------------------------------------------------------------------

describe('extractSymbolMetadata — TSX', () => {
  it('extracts a top-level function component with a normalized signature', () => {
    const content = [
      'export function Greeting(name: string, count: number) {',
      '  return <div>{name}{count}</div>',
      '}',
    ].join('\n')
    const symbols = extractSymbolMetadata(content, 'Greeting.tsx')
    const fn = byQualifiedName(symbols, 'Greeting')
    expect(fn).toBeDefined()
    expect(fn!.symbolKind).toBe('function')
    expect(fn!.signature).toBe('(name:string,count:number)')
    expect(fn!.signatureHash).toBe(sha1_12('(name:string,count:number)'))
    expect(fn!.parentQualifiedName).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// JavaScript
// ---------------------------------------------------------------------------

describe('extractSymbolMetadata — JavaScript', () => {
  const content = [
    'class Widget {',
    '  render(props, ctx) {',
    '    return props',
    '  }',
    '}',
    '',
    'const helper = (a, b) => a + b',
  ].join('\n')

  const symbols = extractSymbolMetadata(content, 'widget.js')

  it('extracts a class method with arity-only signature', () => {
    const method = byQualifiedName(symbols, 'Widget.render')
    expect(method).toBeDefined()
    expect(method!.symbolKind).toBe('method')
    expect(method!.parentQualifiedName).toBe('Widget')
    expect(method!.signature).toBe('(props,ctx)')
    expect(method!.signatureHash).toBe(sha1_12('(props,ctx)'))
  })

  it('extracts a top-level arrow function bound to a const', () => {
    const fn = byQualifiedName(symbols, 'helper')
    expect(fn).toBeDefined()
    expect(fn!.symbolKind).toBe('function')
    expect(fn!.signature).toBe('(a,b)')
    expect(fn!.parentQualifiedName).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe('extractSymbolMetadata — Python', () => {
  const content = [
    'class Auth:',
    '    def validate_token(self, token):',
    '        return len(token) > 0',
    '',
    'def top_level(a, b):',
    '    return a',
  ].join('\n')

  const symbols = extractSymbolMetadata(content, 'auth.py')

  it('extracts the class with no parent', () => {
    const cls = byQualifiedName(symbols, 'Auth')
    expect(cls).toBeDefined()
    expect(cls!.symbolKind).toBe('class')
    expect(cls!.parentQualifiedName).toBeUndefined()
  })

  it('extracts a nested method with a path-free qualifiedName and parent scope', () => {
    const method = byQualifiedName(symbols, 'Auth.validate_token')
    expect(method).toBeDefined()
    expect(method!.symbolKind).toBe('method')
    expect(method!.parentQualifiedName).toBe('Auth')
    expect(method!.signature).toBe('(self,token)')
    expect(method!.signatureHash).toBe(sha1_12('(self,token)'))
  })

  it('extracts a top-level function with no parent scope', () => {
    const fn = byQualifiedName(symbols, 'top_level')
    expect(fn).toBeDefined()
    expect(fn!.symbolKind).toBe('function')
    expect(fn!.signature).toBe('(a,b)')
    expect(fn!.parentQualifiedName).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Graceful degradation for unsupported languages
// ---------------------------------------------------------------------------

describe('extractSymbolMetadata — unsupported languages', () => {
  it('returns [] for Go', () => {
    const content = 'func Add(a, b int) int {\n  return a + b\n}'
    expect(extractSymbolMetadata(content, 'math.go')).toEqual([])
  })

  it('returns [] for Rust', () => {
    const content = 'fn add(a: i32, b: i32) -> i32 {\n  a + b\n}'
    expect(extractSymbolMetadata(content, 'math.rs')).toEqual([])
  })

  it('returns [] for plain text', () => {
    expect(extractSymbolMetadata('just some prose', 'README.md')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('extractSymbolMetadata — determinism', () => {
  it('produces identical output across repeated calls', () => {
    const content = [
      'export class Auth {',
      '  validateToken(token: string): boolean {',
      '    return token.length > 0',
      '  }',
      '}',
    ].join('\n')
    const a = extractSymbolMetadata(content, 'auth.ts')
    const b = extractSymbolMetadata(content, 'auth.ts')
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// Path independence
// ---------------------------------------------------------------------------

describe('extractSymbolMetadata — path independence', () => {
  it('produces identical qualifiedName/signature/signatureHash for the same content under different paths', () => {
    const content = [
      'export class Auth {',
      '  validateToken(token: string): boolean {',
      '    return token.length > 0',
      '  }',
      '}',
    ].join('\n')
    const a = extractSymbolMetadata(content, 'src/auth.ts')
    const b = extractSymbolMetadata(content, 'lib/different/path/auth.ts')

    expect(a.map((s) => ({ q: s.qualifiedName, sig: s.signature, hash: s.signatureHash, parent: s.parentQualifiedName })))
      .toEqual(b.map((s) => ({ q: s.qualifiedName, sig: s.signature, hash: s.signatureHash, parent: s.parentQualifiedName })))
  })
})

// ---------------------------------------------------------------------------
// Migration v23 -> v24
// ---------------------------------------------------------------------------

describe('schema migration v23 -> v24 (symbol identity columns)', () => {
  it('adds nullable identity columns to an existing symbols table and leaves old rows NULL', () => {
    const sqlite = new Database(':memory:')
    try {
      // Simulate a pre-v24 database: minimal tables + a symbols table without
      // the new identity columns, stamped at schema version 23.
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
        CREATE TABLE symbols (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          symbol_name TEXT NOT NULL,
          symbol_kind TEXT NOT NULL,
          language TEXT NOT NULL
        );
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO meta (key, value) VALUES ('schema_version', '23');
      `)

      sqlite.exec(`
        INSERT INTO blobs (blob_hash, size, indexed_at) VALUES ('abc123', 10, 1000);
        INSERT INTO symbols (blob_hash, start_line, end_line, symbol_name, symbol_kind, language)
        VALUES ('abc123', 1, 5, 'validateToken', 'method', 'typescript');
      `)

      runMigrations(sqlite)

      const cols = sqlite.prepare('PRAGMA table_info(symbols)').all() as Array<{ name: string }>
      const colNames = cols.map((c) => c.name)
      expect(colNames).toContain('qualified_name')
      expect(colNames).toContain('signature')
      expect(colNames).toContain('signature_hash')
      expect(colNames).toContain('parent_qualified_name')

      const row = sqlite.prepare('SELECT * FROM symbols WHERE blob_hash = ?').get('abc123') as Record<string, unknown>
      expect(row.qualified_name).toBeNull()
      expect(row.signature).toBeNull()
      expect(row.signature_hash).toBeNull()
      expect(row.parent_qualified_name).toBeNull()

      const version = sqlite.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string }
      expect(parseInt(version.value, 10)).toBeGreaterThanOrEqual(24)
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
        CREATE TABLE symbols (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          blob_hash TEXT NOT NULL REFERENCES blobs(blob_hash),
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          symbol_name TEXT NOT NULL,
          symbol_kind TEXT NOT NULL,
          language TEXT NOT NULL
        );
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO meta (key, value) VALUES ('schema_version', '23');
      `)
      runMigrations(sqlite)
      expect(() => runMigrations(sqlite)).not.toThrow()
    } finally {
      sqlite.close()
    }
  })
})
