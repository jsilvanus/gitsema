/**
 * `gitsema admin models` — superadmin-gated allow-lists for defined embedding
 * profiles and narrator/guide model configs (Phase 129 /
 * locked-model-set-plan.md §5 Phase 2).
 *
 * Operates directly against the local server DB (operator-only; requires
 * local DB access), same trust tier as `gitsema orgs`/`gitsema users`. The
 * resulting policy is enforced at two existing call sites:
 *   - `gitsema models activate` (narrator/guide), server-wide only.
 *   - the HTTP `remote-index` profile picker, server-wide + org-narrowed.
 */

import { Command } from 'commander'
import { getRawDb } from '../../core/db/sqlite.js'
import { getOrgByName } from '../../core/auth/orgs.js'
import { loadEmbeddingProfileConfigs } from '../../core/embedding/profiles.js'
import { listNarratorConfigs, listGuideConfigs } from '../../core/narrator/resolveNarrator.js'
import {
  type ModelPolicyKind,
  getServerPolicy,
  getOrgPolicy,
  allowServer,
  denyServer,
  allowOrg,
  denyOrg,
  getEffectiveAllowedSet,
  resetServerPolicy,
  resetOrgPolicy,
} from '../../core/admin/modelPolicy.js'

function validateKind(kind: string): ModelPolicyKind {
  if (kind === 'embedding' || kind === 'narrator' || kind === 'guide') return kind
  console.error("Error: --kind must be 'embedding', 'narrator', or 'guide'")
  process.exit(1)
}

function universeFor(kind: ModelPolicyKind): string[] {
  if (kind === 'embedding') return loadEmbeddingProfileConfigs().map((p) => p.name)
  const rawDb = getRawDb()
  if (kind === 'narrator') return listNarratorConfigs(rawDb).map((c) => c.name)
  return listGuideConfigs(rawDb).map((c) => c.name)
}

function resolveOrgIdOrExit(orgName: string): number {
  const org = getOrgByName(getRawDb(), orgName)
  if (!org) {
    console.error(`Error: org '${orgName}' not found`)
    process.exit(1)
  }
  return org.id
}

export function adminCommand(): Command {
  const cmd = new Command('admin').description('Superadmin-only server administration (Phase 129)')
  const modelsCmd = new Command('models').description(
    'Manage which defined embedding profiles / narrator / guide model configs are enabled',
  )

  modelsCmd
    .command('list')
    .description('Show defined items and which are currently enabled')
    .requiredOption('--kind <kind>', 'embedding | narrator | guide')
    .option('--org <name>', "show the effective set narrowed for this org's members")
    .action((opts: { kind: string; org?: string }) => {
      const kind = validateKind(opts.kind)
      const rawDb = getRawDb()
      const universe = universeFor(kind)
      const orgId = opts.org ? resolveOrgIdOrExit(opts.org) : undefined
      const effective = new Set(getEffectiveAllowedSet(rawDb, kind, orgId, universe))
      if (universe.length === 0) {
        console.log(`No ${kind} items are defined.`)
        return
      }
      console.log(`${'Enabled'.padEnd(8)}  Name`)
      for (const name of universe) console.log(`${(effective.has(name) ? '✓' : '-').padEnd(8)}  ${name}`)
    })

  modelsCmd
    .command('allow <identifier>')
    .description('Add an item to the enabled set (server-wide, or --org to narrow further)')
    .requiredOption('--kind <kind>', 'embedding | narrator | guide')
    .option('--org <name>', 'narrow for this org instead of server-wide (must already be enabled server-wide)')
    .action((identifier: string, opts: { kind: string; org?: string }) => {
      const kind = validateKind(opts.kind)
      const rawDb = getRawDb()
      const universe = universeFor(kind)
      if (!universe.includes(identifier)) {
        console.error(`Error: '${identifier}' is not a defined ${kind} item. Defined: ${universe.join(', ') || '(none)'}`)
        process.exit(1)
      }
      if (opts.org) {
        const orgId = resolveOrgIdOrExit(opts.org)
        const serverAllowed = getEffectiveAllowedSet(rawDb, kind, undefined, universe)
        if (!serverAllowed.includes(identifier)) {
          console.error(`Error: '${identifier}' is not enabled server-wide; org narrowing cannot widen past the server-wide set`)
          process.exit(1)
        }
        allowOrg(rawDb, kind, orgId, identifier)
        console.log(`Enabled '${identifier}' (${kind}) for org '${opts.org}'.`)
        return
      }
      allowServer(rawDb, kind, identifier)
      console.log(`Enabled '${identifier}' (${kind}) server-wide.`)
    })

  modelsCmd
    .command('deny <identifier>')
    .description('Remove an item from the enabled set (server-wide, or --org to narrow further)')
    .requiredOption('--kind <kind>', 'embedding | narrator | guide')
    .option('--org <name>', 'narrow for this org instead of server-wide')
    .action((identifier: string, opts: { kind: string; org?: string }) => {
      const kind = validateKind(opts.kind)
      const rawDb = getRawDb()
      const universe = universeFor(kind)
      if (opts.org) {
        const orgId = resolveOrgIdOrExit(opts.org)
        const serverAllowed = getEffectiveAllowedSet(rawDb, kind, undefined, universe)
        denyOrg(rawDb, kind, orgId, identifier, serverAllowed)
        console.log(`Disabled '${identifier}' (${kind}) for org '${opts.org}'.`)
        return
      }
      denyServer(rawDb, kind, identifier, universe)
      console.log(`Disabled '${identifier}' (${kind}) server-wide.`)
    })

  modelsCmd
    .command('reset')
    .description('Clear an explicit allow-list, reverting to "all defined items enabled"')
    .requiredOption('--kind <kind>', 'embedding | narrator | guide')
    .option('--org <name>', "reset only this org's narrowing, leaving the server-wide policy untouched")
    .action((opts: { kind: string; org?: string }) => {
      const kind = validateKind(opts.kind)
      const rawDb = getRawDb()
      if (opts.org) {
        const orgId = resolveOrgIdOrExit(opts.org)
        resetOrgPolicy(rawDb, kind, orgId)
        console.log(`Reset org '${opts.org}' narrowing for ${kind} (now inherits the server-wide set).`)
        return
      }
      resetServerPolicy(rawDb, kind)
      console.log(`Reset server-wide ${kind} policy (now defaults to all defined items enabled).`)
    })

  cmd.addCommand(modelsCmd)
  return cmd
}

// Re-exported for tests that need to inspect raw policy state without going through the CLI action callbacks.
export { getServerPolicy, getOrgPolicy }
