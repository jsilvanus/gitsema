/**
 * `gitsema audit log` — query the identity/authorization audit trail (Phase 125 /
 * multi-tenant-auth §5 Phase D). Operates directly against the local server DB
 * (operator-only; requires local DB access), same model as `gitsema orgs *`.
 */

import { Command } from 'commander'
import { getRawDb } from '../../core/db/sqlite.js'
import { getOrgByName } from '../../core/auth/orgs.js'
import { listAuditLog } from '../../core/auth/auditLog.js'

export function auditCommand(): Command {
  const cmd = new Command('audit').description('Query the identity/authorization audit trail (Phase 125)')

  cmd
    .command('log')
    .description('List audit log entries, newest first')
    .option('--org <org>', 'filter by org name')
    .option('--repo <repoId>', 'filter by repo id')
    .option('--limit <n>', 'max entries to return', '100')
    .action((opts: { org?: string; repo?: string; limit: string }) => {
      const rawDb = getRawDb()
      let orgId: number | undefined
      if (opts.org) {
        const org = getOrgByName(rawDb, opts.org)
        if (!org) {
          console.error(`Error: org '${opts.org}' not found`)
          process.exit(1)
        }
        orgId = org.id
      }
      const limit = Number(opts.limit)
      const entries = listAuditLog(rawDb, { orgId, repoId: opts.repo, limit })
      if (entries.length === 0) {
        console.log('No audit log entries.')
        return
      }
      console.log(
        `${'Time'.padEnd(20)}  ${'Action'.padEnd(18)}  ${'Actor'.padEnd(8)}  ${'Org'.padEnd(6)}  ${'Repo'.padEnd(20)}  Target`,
      )
      for (const e of entries) {
        const time = new Date(e.createdAt * 1000).toISOString().slice(0, 19).replace('T', ' ')
        console.log(
          `${time.padEnd(20)}  ${e.action.padEnd(18)}  ${String(e.actorUserId ?? '-').padEnd(8)}  ${String(e.orgId ?? '-').padEnd(6)}  ${String(e.repoId ?? '-').padEnd(20)}  ${e.target ?? '-'}`,
        )
      }
    })

  return cmd
}
