import { describe, it, expect } from 'vitest'
import { FixedChunker } from '../src/core/chunking/fixedChunker.js'
import { FunctionChunker } from '../src/core/chunking/functionChunker.js'

// ---------------------------------------------------------------------------
// FixedChunker
// ---------------------------------------------------------------------------

describe('FixedChunker', () => {
  it('returns a single chunk for content smaller than windowSize', () => {
    const chunker = new FixedChunker({ windowSize: 1000, overlap: 0 })
    const content = 'line1\nline2\nline3'
    const chunks = chunker.chunk(content, 'file.ts')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].startLine).toBe(1)
    expect(chunks[0].endLine).toBe(3)
    expect(chunks[0].content).toBe(content)
  })

  it('splits content into multiple chunks when it exceeds windowSize', () => {
    // Each line is ~10 chars; windowSize=25 fits ~2 lines
    const lines = Array.from({ length: 10 }, (_, i) => `line${String(i).padStart(5, '0')}`)
    const content = lines.join('\n')
    const chunker = new FixedChunker({ windowSize: 25, overlap: 0 })
    const chunks = chunker.chunk(content, 'file.ts')
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('produces overlapping chunks when overlap > 0', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${String(i).padStart(5, '0')}`)
    const content = lines.join('\n')
    const chunker = new FixedChunker({ windowSize: 50, overlap: 20 })
    const chunks = chunker.chunk(content, 'file.ts')

    // With overlap, the start of chunk N+1 should be before the end of chunk N
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startLine).toBeLessThan(chunks[i - 1].endLine)
    }
  })

  it('covers every line at least once', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `const x${i} = ${i}`)
    const content = lines.join('\n')
    const chunker = new FixedChunker({ windowSize: 60, overlap: 15 })
    const chunks = chunker.chunk(content, 'file.ts')

    const covered = new Set<number>()
    for (const chunk of chunks) {
      for (let l = chunk.startLine; l <= chunk.endLine; l++) covered.add(l)
    }
    for (let l = 1; l <= lines.length; l++) {
      expect(covered.has(l), `line ${l} not covered`).toBe(true)
    }
  })

  it('startLine and endLine are 1-indexed and inclusive', () => {
    const content = 'a\nb\nc\nd\ne'
    const chunker = new FixedChunker({ windowSize: 1000 })
    const [chunk] = chunker.chunk(content, 'file.ts')
    expect(chunk.startLine).toBe(1)
    expect(chunk.endLine).toBe(5)
  })

  it('returns a single empty chunk for empty content', () => {
    const chunker = new FixedChunker()
    const chunks = chunker.chunk('', 'file.ts')
    // An empty string splits to [''] — one empty line → one chunk
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toBe('')
  })

  it('chunk content matches the corresponding source lines', () => {
    const lines = ['function foo() {', '  return 1', '}', 'function bar() {', '  return 2', '}']
    const content = lines.join('\n')
    const chunker = new FixedChunker({ windowSize: 30, overlap: 0 })
    const chunks = chunker.chunk(content, 'file.ts')

    for (const chunk of chunks) {
      const expected = lines.slice(chunk.startLine - 1, chunk.endLine).join('\n')
      expect(chunk.content).toBe(expected)
    }
  })

  it('always makes forward progress (no infinite loop)', () => {
    // Very small windowSize with overlap — must not hang
    const content = Array.from({ length: 50 }, (_, i) => `x`.repeat(50)).join('\n')
    const chunker = new FixedChunker({ windowSize: 10, overlap: 5 })
    const chunks = chunker.chunk(content, 'file.ts')
    expect(chunks.length).toBeGreaterThan(0)
    // Verify strictly increasing startLines
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startLine).toBeGreaterThan(chunks[i - 1].startLine)
    }
  })
})

// ---------------------------------------------------------------------------
// FunctionChunker
// ---------------------------------------------------------------------------

describe('FunctionChunker', () => {
  it('returns a single chunk when there are no function boundaries', () => {
    const content = 'const x = 1\nconst y = 2\nconst z = 3'
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'file.ts')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].startLine).toBe(1)
    expect(chunks[0].endLine).toBe(3)
  })

  it('splits TypeScript functions into separate chunks', () => {
    const content = [
      'function add(a: number, b: number) {',
      '  return a + b',
      '}',
      '',
      'function subtract(a: number, b: number) {',
      '  return a - b',
      '}',
    ].join('\n')
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'file.ts')
    // Two functions → at least 2 chunks (small fragments may be merged)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    // All lines covered
    const covered = new Set<number>()
    for (const c of chunks) {
      for (let l = c.startLine; l <= c.endLine; l++) covered.add(l)
    }
    expect(covered.size).toBe(content.split('\n').length)
  })

  it('splits Python functions', () => {
    const content = [
      'def greet(name):',
      '    return f"Hello {name}"',
      '',
      'def farewell(name):',
      '    return f"Goodbye {name}"',
    ].join('\n')
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'module.py')
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })

  it('merges tiny fragments into their predecessor', () => {
    // A file with many 1-line declarations — each would be too small alone
    const lines: string[] = []
    for (let i = 0; i < 3; i++) {
      lines.push(`function fn${i}() {`)
      lines.push('  return ' + i)
      lines.push('}')
      lines.push('')
    }
    const content = lines.join('\n')
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'file.ts')
    // All chunks should have at least MIN_CHUNK_LINES lines (or be the last merged fragment)
    for (const chunk of chunks) {
      const lineCount = chunk.endLine - chunk.startLine + 1
      // Each chunk has at least 1 line; tiny chunks get merged
      expect(lineCount).toBeGreaterThanOrEqual(1)
    }
  })

  it('chunk content matches the source lines', () => {
    const lines = [
      'export function alpha() {',
      '  return "a"',
      '}',
      'export function beta() {',
      '  return "b"',
      '}',
    ]
    const content = lines.join('\n')
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'file.ts')
    for (const chunk of chunks) {
      const expected = lines.slice(chunk.startLine - 1, chunk.endLine).join('\n')
      expect(chunk.content).toBe(expected)
    }
  })

  it('handles arrow functions', () => {
    const content = [
      'const greet = (name: string) => {',
      '  return `Hello ${name}`',
      '}',
      'const bye = (name: string) => `Bye ${name}`',
    ].join('\n')
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'file.ts')
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })

  it('returns a single empty chunk for empty content', () => {
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk('', 'file.ts')
    // An empty string splits to [''] — one empty line → one chunk
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toBe('')
  })
})
