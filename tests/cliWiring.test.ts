/**
 * CLI wiring regression test.
 *
 * Ensures that:
 *  - every key in COMMAND_GROUPS resolves to a registered command name or alias
 *  - previously-unreachable commands are now registered
 *  - no duplicate command names exist anywhere in the program tree
 */

import { describe, it, expect } from 'vitest'
import type { Command } from 'commander'
import { buildProgram, COMMAND_GROUPS } from '../src/cli/program.js'

/** Collect every name + alias for a command and all its (visible and hidden) subcommands. */
function collectNames(cmd: Command): string[] {
  const names = [cmd.name(), ...cmd.aliases()]
  for (const sub of cmd.commands) {
    names.push(...collectNames(sub))
  }
  return names
}

/** Collect (name, parentPath) pairs for duplicate detection at each nesting level. */
function collectAllNamesFlat(cmd: Command): string[] {
  const names: string[] = []
  for (const sub of cmd.commands) {
    names.push(sub.name(), ...sub.aliases())
    names.push(...collectAllNamesFlat(sub))
  }
  return names
}

describe('CLI wiring', () => {
  const program = buildProgram()
  const allNames = new Set(collectNames(program))

  it('every COMMAND_GROUPS key resolves to a registered command name or alias', () => {
    const missing: string[] = []
    for (const key of Object.keys(COMMAND_GROUPS)) {
      if (!allNames.has(key)) missing.push(key)
    }
    expect(missing).toEqual([])
  })

  it('registers the previously-unreachable commands', () => {
    const expected = ['first-seen', 'file-evolution', 'pr-report', 'triage', 'policy-check', 'ownership']
    const missing = expected.filter((name) => !allNames.has(name))
    expect(missing).toEqual([])
  })

  it('the deprecated `policy check` alias still works', () => {
    const policy = program.commands.find((c) => c.name() === 'policy')
    expect(policy).toBeDefined()
    const check = policy?.commands.find((c) => c.name() === 'check')
    expect(check).toBeDefined()
  })

  it('has no duplicate top-level command names or aliases', () => {
    const topLevel = program.commands.flatMap((c) => [c.name(), ...c.aliases()])
    const seen = new Map<string, number>()
    for (const name of topLevel) {
      seen.set(name, (seen.get(name) ?? 0) + 1)
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name)
    expect(duplicates).toEqual([])
  })

  it('has no duplicate command names within any single subcommand level', () => {
    function checkLevel(cmd: Command, path: string) {
      const names = cmd.commands.flatMap((c) => [c.name(), ...c.aliases()])
      const seen = new Map<string, number>()
      for (const name of names) {
        seen.set(name, (seen.get(name) ?? 0) + 1)
      }
      const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name)
      expect(duplicates, `duplicates under ${path}`).toEqual([])
      for (const sub of cmd.commands) {
        checkLevel(sub, `${path} ${sub.name()}`)
      }
    }
    checkLevel(program, 'gitsema')
  })

  it('the workflow parent command has a description', () => {
    const workflow = program.commands.find((c) => c.name() === 'workflow')
    expect(workflow).toBeDefined()
    expect(workflow?.description()).toBeTruthy()
  })
})
