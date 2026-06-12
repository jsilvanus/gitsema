import { describe, it, expect } from 'vitest'
import { resolveCiDiffSinks } from '../src/cli/commands/ciDiff.js'

describe('resolveCiDiffSinks', () => {
  it('defaults to text on stdout when nothing is given', () => {
    expect(resolveCiDiffSinks({})).toEqual([{ format: 'text' }])
  })

  it('falls back to legacy --format (non-text)', () => {
    expect(resolveCiDiffSinks({ format: 'json' })).toEqual([{ format: 'json' }])
    expect(resolveCiDiffSinks({ format: 'html' })).toEqual([{ format: 'html', file: 'ci-diff.html' }])
  })

  it('legacy --format text stays on stdout', () => {
    expect(resolveCiDiffSinks({ format: 'text' })).toEqual([{ format: 'text' }])
  })

  it('--out takes precedence over --format', () => {
    expect(resolveCiDiffSinks({ out: ['json'], format: 'html' })).toEqual([{ format: 'json' }])
  })

  it('--out html with no file defaults to ci-diff.html', () => {
    expect(resolveCiDiffSinks({ out: ['html'] })).toEqual([{ format: 'html', file: 'ci-diff.html' }])
  })

  it('--out html:file keeps the given file', () => {
    expect(resolveCiDiffSinks({ out: ['html:custom.html'] })).toEqual([{ format: 'html', file: 'custom.html' }])
  })

  it('--out json:file writes to that file', () => {
    expect(resolveCiDiffSinks({ out: ['json:result.json'] })).toEqual([{ format: 'json', file: 'result.json' }])
  })

  it('supports multiple --out specs', () => {
    expect(resolveCiDiffSinks({ out: ['text', 'json:result.json'] })).toEqual([
      { format: 'text' },
      { format: 'json', file: 'result.json' },
    ])
  })
})
