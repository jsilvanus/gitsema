/**
 * Phase 112 tests: `emitSubgraphOutputs` (`cli/lib/graphOutput.ts`) — the
 * shared `--out` sink dispatcher used by every graph-traversal command
 * (`graph neighbors`, `graph path`, `blast-radius`, `relate`, `similar`,
 * `hotspots`) to emit html/json/markdown/text renderings of a
 * `RenderableSubgraph`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { emitSubgraphOutputs } from '../src/cli/lib/graphOutput.js'
import type { RenderableSubgraph } from '../src/core/graph/subgraphView.js'
import type { OutputSpec } from '../src/utils/outputSink.js'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const SUB: RenderableSubgraph = {
  rootKeys: ['file:a.ts'],
  nodes: [
    { nodeKey: 'file:a.ts', kind: 'file', displayName: 'a.ts', path: 'a.ts' },
    { nodeKey: 'file:b.ts', kind: 'file', displayName: 'b.ts', path: 'b.ts' },
  ],
  edges: [{ srcKey: 'file:a.ts', dstKey: 'file:b.ts', edgeType: 'imports' }],
}

describe('emitSubgraphOutputs', () => {
  it('writes an HTML file for an html sink', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-graphout-'))
    tmpDirs.push(tmpDir)
    const file = join(tmpDir, 'graph.html')
    const sink: OutputSpec = { format: 'html', file }
    emitSubgraphOutputs([sink], SUB, 'Test')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('<!DOCTYPE html>')
  })

  it('writes JSON matching the subgraph for a json sink', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-graphout-'))
    tmpDirs.push(tmpDir)
    const file = join(tmpDir, 'graph.json')
    emitSubgraphOutputs([{ format: 'json', file }], SUB, 'Test')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(SUB)
  })

  it('writes a markdown bullet list for a markdown sink', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-graphout-'))
    tmpDirs.push(tmpDir)
    const file = join(tmpDir, 'graph.md')
    emitSubgraphOutputs([{ format: 'markdown', file }], SUB, 'Test')
    expect(readFileSync(file, 'utf8')).toContain('**a.ts**')
  })

  it('prints the ASCII tree to stdout for a text sink with no file', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    emitSubgraphOutputs([{ format: 'text' }], SUB, 'Test')
    const written = spy.mock.calls.map((c) => c[0]).join('')
    expect(written).toContain('a.ts [file]')
  })

  it('handles multiple sinks in one call', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gitsema-graphout-'))
    tmpDirs.push(tmpDir)
    const htmlFile = join(tmpDir, 'graph.html')
    const jsonFile = join(tmpDir, 'graph.json')
    emitSubgraphOutputs([{ format: 'html', file: htmlFile }, { format: 'json', file: jsonFile }], SUB, 'Test')
    expect(existsSync(htmlFile)).toBe(true)
    expect(existsSync(jsonFile)).toBe(true)
  })
})
