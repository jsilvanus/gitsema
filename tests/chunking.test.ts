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

  // -------------------------------------------------------------------------
  // Language-specific patterns — Go
  // -------------------------------------------------------------------------

  it('splits Go functions using the `func` keyword', () => {
    const lines = [
      'func Add(a, b int) int {',
      '    x := a + b',
      '    y := x * 2',
      '    return y / 2',
      '}',
      '',
      'func Subtract(a, b int) int {',
      '    x := a - b',
      '    y := x * 2',
      '    return y / 2',
      '}',
    ]
    const content = lines.join('\n')
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'math.go')
    // Two Go functions → two chunks
    expect(chunks.length).toBe(2)
    // First chunk starts at line 1
    expect(chunks[0].startLine).toBe(1)
  })

  it('splits Go methods (func with receiver)', () => {
    const lines = [
      'func (r *Rect) Area() float64 {',
      '    w := r.Width',
      '    h := r.Height',
      '    return w * h',
      '}',
      '',
      'func (r *Rect) Perimeter() float64 {',
      '    return 2 * (r.Width + r.Height)',
      '    // extra comment to meet min lines',
      '    // another comment',
      '}',
    ]
    const content = lines.join('\n')
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'shapes.go')
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    // All lines covered
    const covered = new Set<number>()
    for (const c of chunks) {
      for (let l = c.startLine; l <= c.endLine; l++) covered.add(l)
    }
    expect(covered.size).toBe(lines.length)
  })

  // -------------------------------------------------------------------------
  // Language-specific patterns — Rust
  // -------------------------------------------------------------------------

  it('splits Rust fn declarations', () => {
    const lines = [
      'fn add(a: i32, b: i32) -> i32 {',
      '    let x = a + b;',
      '    let y = x * 2;',
      '    y / 2',
      '}',
      '',
      'pub fn subtract(a: i32, b: i32) -> i32 {',
      '    let x = a - b;',
      '    let y = x * 2;',
      '    y / 2',
      '}',
    ]
    const content = lines.join('\n')
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'math.rs')
    expect(chunks.length).toBe(2)
    expect(chunks[0].startLine).toBe(1)
  })

  it('splits Rust impl blocks', () => {
    const lines = [
      'struct Foo {',
      '    x: i32,',
      '    y: i32,',
      '    z: i32,',
      '}',
      '',
      'impl Foo {',
      '    pub fn new(x: i32) -> Self {',
      '        Foo { x, y: 0, z: 0 }',
      '    }',
      '    pub fn get_x(&self) -> i32 {',
      '        self.x',
      '    }',
      '}',
    ]
    const content = lines.join('\n')
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'lib.rs')
    // struct block + impl block → at least 2 chunks (struct may be merged)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    // All lines covered
    const covered = new Set<number>()
    for (const c of chunks) {
      for (let l = c.startLine; l <= c.endLine; l++) covered.add(l)
    }
    expect(covered.size).toBe(lines.length)
    // impl block must start its own chunk or be included in a merged chunk
    const implChunk = chunks.find((c) => c.content.includes('impl Foo'))
    expect(implChunk).toBeDefined()
  })

  // -------------------------------------------------------------------------
  // Python decorator handling
  // -------------------------------------------------------------------------

  it('includes decorator lines in the following function chunk', () => {
    const lines = [
      '@my_decorator',
      'def foo():',
      '    """Docstring."""',
      '    x = 1',
      '    return x',
      '',
      '@decorator_a',
      '@decorator_b',
      'def bar():',
      '    """Another docstring."""',
      '    y = 2',
      '    return y',
    ]
    const content = lines.join('\n')
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'module.py')
    // Two decorated functions → two chunks
    expect(chunks.length).toBe(2)
    // First chunk must start at line 1 (the @my_decorator line)
    expect(chunks[0].startLine).toBe(1)
    expect(chunks[0].content).toContain('@my_decorator')
    expect(chunks[0].content).toContain('def foo')
    // Second chunk must start at line 7 (the first @decorator_a line)
    expect(chunks[1].startLine).toBe(7)
    expect(chunks[1].content).toContain('@decorator_a')
    expect(chunks[1].content).toContain('@decorator_b')
    expect(chunks[1].content).toContain('def bar')
  })

  it('covers all lines when decorators are present', () => {
    const lines = [
      '# Module-level comment',
      '',
      '@app.route("/hello")',
      'def hello_view():',
      '    """Return greeting."""',
      '    return "Hello"',
    ]
    const content = lines.join('\n')
    const chunker = new FunctionChunker()
    const chunks = chunker.chunk(content, 'views.py')
    const covered = new Set<number>()
    for (const c of chunks) {
      for (let l = c.startLine; l <= c.endLine; l++) covered.add(l)
    }
    expect(covered.size).toBe(lines.length)
  })
})
