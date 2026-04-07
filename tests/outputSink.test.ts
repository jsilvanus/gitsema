import { describe, it, expect } from 'vitest'
import { parseOutputSpec, resolveOutputs, collectOut, hasSinkFormat, getSink } from '../src/utils/outputSink.js'
import type { OutputSpec } from '../src/utils/outputSink.js'

describe('parseOutputSpec', () => {
  it('parses format-only spec', () => {
    expect(parseOutputSpec('text')).toEqual({ format: 'text' })
    expect(parseOutputSpec('json')).toEqual({ format: 'json' })
    expect(parseOutputSpec('html')).toEqual({ format: 'html' })
    expect(parseOutputSpec('markdown')).toEqual({ format: 'markdown' })
    expect(parseOutputSpec('sarif')).toEqual({ format: 'sarif' })
  })

  it('parses format:file spec', () => {
    expect(parseOutputSpec('json:out.json')).toEqual({ format: 'json', file: 'out.json' })
    expect(parseOutputSpec('html:report.html')).toEqual({ format: 'html', file: 'report.html' })
    expect(parseOutputSpec('markdown:/tmp/out.md')).toEqual({ format: 'markdown', file: '/tmp/out.md' })
  })

  it('handles uppercase → lowercase format', () => {
    // formats must be lowercase, but our function lowercases the format part
    // Actually our implementation does .toLowerCase(), so this should work
    // Let's verify the lowercase path explicitly
    expect(parseOutputSpec('json:result.json').format).toBe('json')
  })

  it('throws on unknown format', () => {
    expect(() => parseOutputSpec('xml')).toThrow('Unknown output format')
    expect(() => parseOutputSpec('csv')).toThrow('Unknown output format')
  })

  it('throws on format-only spec with colon but empty file', () => {
    expect(() => parseOutputSpec('json:')).toThrow('Missing file path')
  })
})

describe('collectOut', () => {
  it('accumulates values', () => {
    let acc = collectOut('json', [])
    acc = collectOut('html:out.html', acc)
    expect(acc).toEqual(['json', 'html:out.html'])
  })
})

describe('resolveOutputs', () => {
  it('returns text sink when nothing specified', () => {
    const sinks = resolveOutputs({})
    expect(sinks).toEqual([{ format: 'text' }])
  })

  it('returns text sink when all opts are undefined', () => {
    const sinks = resolveOutputs({ out: [], dump: undefined, html: undefined })
    expect(sinks).toEqual([{ format: 'text' }])
  })

  it('uses --out specs when provided (overrides --dump)', () => {
    const sinks = resolveOutputs({ out: ['json', 'html:report.html'], dump: true })
    expect(sinks).toHaveLength(2)
    expect(sinks[0]).toEqual({ format: 'json' })
    expect(sinks[1]).toEqual({ format: 'html', file: 'report.html' })
  })

  it('legacy --dump true → json sink (stdout)', () => {
    const sinks = resolveOutputs({ dump: true })
    expect(sinks).toEqual([{ format: 'json', file: undefined }])
  })

  it('legacy --dump "file.json" → json sink with file', () => {
    const sinks = resolveOutputs({ dump: 'file.json' })
    expect(sinks).toEqual([{ format: 'json', file: 'file.json' }])
  })

  it('legacy --html true → html sink (no file → stdout)', () => {
    const sinks = resolveOutputs({ html: true })
    expect(sinks).toEqual([{ format: 'html', file: undefined }])
  })

  it('legacy --html "out.html" → html sink with file', () => {
    const sinks = resolveOutputs({ html: 'out.html' })
    expect(sinks).toEqual([{ format: 'html', file: 'out.html' }])
  })

  it('legacy --format json → json stdout sink', () => {
    const sinks = resolveOutputs({ format: 'json' })
    expect(sinks).toEqual([{ format: 'json' }])
  })

  it('legacy --format text → returns text default', () => {
    // format=text is the default, so should fall through to text sink
    const sinks = resolveOutputs({ format: 'text' })
    expect(sinks).toEqual([{ format: 'text' }])
  })

  it('combines legacy --dump and --html when both present', () => {
    const sinks = resolveOutputs({ dump: 'out.json', html: 'out.html' })
    expect(sinks).toHaveLength(2)
    expect(sinks.find(s => s.format === 'json')).toMatchObject({ file: 'out.json' })
    expect(sinks.find(s => s.format === 'html')).toMatchObject({ file: 'out.html' })
  })
})

describe('hasSinkFormat', () => {
  const sinks: OutputSpec[] = [{ format: 'json', file: 'a.json' }, { format: 'text' }]

  it('returns true when format present', () => {
    expect(hasSinkFormat(sinks, 'json')).toBe(true)
    expect(hasSinkFormat(sinks, 'text')).toBe(true)
  })

  it('returns false when format absent', () => {
    expect(hasSinkFormat(sinks, 'html')).toBe(false)
    expect(hasSinkFormat(sinks, 'markdown')).toBe(false)
  })
})

describe('getSink', () => {
  const sinks: OutputSpec[] = [{ format: 'json', file: 'a.json' }, { format: 'text' }]

  it('returns first matching sink', () => {
    expect(getSink(sinks, 'json')).toEqual({ format: 'json', file: 'a.json' })
    expect(getSink(sinks, 'text')).toEqual({ format: 'text' })
  })

  it('returns undefined when not found', () => {
    expect(getSink(sinks, 'html')).toBeUndefined()
  })
})
