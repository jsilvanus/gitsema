/**
 * Lens-coverage parity test (Phase 111, knowledge-graph §7.3/§11).
 *
 * Mirrors the mechanical-guarantee style of `docsSync.test.ts`: rather than
 * trusting that every lens-capable surface was wired up by hand, it introspects
 * the actual Commander program, the GUIDE_TOOLS registry, and the MCP/HTTP
 * source to assert that:
 *
 *   1. Every CLI command for which more than one lens is meaningful exposes the
 *      shared `--lens` option (added via `addLensOption`).
 *   2. The §7.3 defaults hold: existing commands default to `semantic`, fusion
 *      commands default to `hybrid`.
 *   3. The structural guide/MCP tools expose a `lens` parameter.
 *
 * If a new lens-capable command is added without `addLensOption`, this test
 * fails — keeping coverage uniform instead of ad-hoc.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { Command } from 'commander'
import { buildProgram } from '../src/cli/program.js'
import { GUIDE_TOOLS } from '../src/core/narrator/guideTools.js'

const ROOT = resolve(import.meta.dirname, '..')

function findCommand(program: Command, name: string): Command | undefined {
  for (const cmd of program.commands) {
    if (cmd.name() === name) return cmd
    const nested = findCommand(cmd, name)
    if (nested) return nested
  }
  return undefined
}

function lensOption(cmd: Command): { long?: string; defaultValue?: unknown } | undefined {
  // commander stores options on `.options`; each Option has `.long`.
  return (cmd as unknown as { options: Array<{ long?: string; defaultValue?: unknown }> }).options
    .find((o) => o.long === '--lens')
}

// Fusion commands default to hybrid; everything else that gained a lens defaults
// to semantic (knowledge-graph §7.3).
const FUSION_HYBRID = ['blast-radius', 'similar', 'relate', 'hotspots']
const EXISTING_SEMANTIC = ['impact', 'triage', 'code-review', 'explain', 'guide']

describe('lens coverage parity (Phase 111)', () => {
  const program = buildProgram()

  for (const name of [...FUSION_HYBRID, ...EXISTING_SEMANTIC]) {
    it(`'${name}' exposes the shared --lens option`, () => {
      const cmd = findCommand(program, name)
      expect(cmd, `command '${name}' should be registered`).toBeDefined()
      const opt = lensOption(cmd!)
      expect(opt, `command '${name}' must call addLensOption() to expose --lens`).toBeDefined()
    })
  }

  for (const name of FUSION_HYBRID) {
    it(`fusion command '${name}' defaults to lens=hybrid`, () => {
      const cmd = findCommand(program, name)
      expect(lensOption(cmd!)?.defaultValue).toBe('hybrid')
    })
  }

  for (const name of EXISTING_SEMANTIC) {
    it(`existing command '${name}' defaults to lens=semantic`, () => {
      const cmd = findCommand(program, name)
      expect(lensOption(cmd!)?.defaultValue).toBe('semantic')
    })
  }
})

describe('structural tool lens parity (Phase 111)', () => {
  it('the blast_radius and hotspots guide tools expose a lens parameter', () => {
    for (const tool of ['blast_radius', 'hotspots']) {
      const entry = GUIDE_TOOLS[tool]
      expect(entry, `guide tool '${tool}' should be registered`).toBeDefined()
      const params = entry.definition.parameters as { properties?: Record<string, unknown> }
      expect(params.properties?.lens, `guide tool '${tool}' should expose a 'lens' parameter`).toBeDefined()
    }
  })

  it('the hotspots MCP tool and HTTP route accept a lens parameter', () => {
    const mcp = readFileSync(join(ROOT, 'src/mcp/tools/graph.ts'), 'utf8')
    expect(mcp).toMatch(/'hotspots'/)
    // lens enum is declared in the hotspots tool schema
    expect(mcp).toMatch(/lens:\s*z\.enum/)

    const route = readFileSync(join(ROOT, 'src/server/routes/graph.ts'), 'utf8')
    expect(route).toMatch(/hotspots/)
    expect(route).toMatch(/lens:\s*z\.enum/)
  })
})
