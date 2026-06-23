/**
 * `gitsema orgs` / `gitsema users` — org & membership management CLI (Phase 123 /
 * multi-tenant-auth §5 Phase B). Operates directly against the local server DB
 * (operator-only; requires local DB access), same model as `gitsema auth create-user`
 * and `gitsema repos token *`.
 */

import { Command } from 'commander'
import { getRawDb } from '../../core/db/sqlite.js'
import { createUser, getUserByUsername } from '../../core/auth/identity.js'
import {
  createOrg,
  getOrgByName,
  addOrgMember,
  removeOrgMember,
  listOrgMembers,
  listOrgsForUser,
  maybeProvisionPersonalOrg,
  PersonalOrgImmutableError,
} from '../../core/auth/orgs.js'

function resolveOrgOrExit(name: string) {
  const org = getOrgByName(getRawDb(), name)
  if (!org) {
    console.error(`Error: org '${name}' not found`)
    process.exit(1)
  }
  return org
}

function resolveUserOrExit(username: string) {
  const user = getUserByUsername(getRawDb(), username)
  if (!user) {
    console.error(`Error: user '${username}' not found`)
    process.exit(1)
  }
  return user
}

export function orgsCommand(): Command {
  const cmd = new Command('orgs').description('Manage orgs and org membership (Phase 123)')

  cmd
    .command('create <name>')
    .description('Create a new team org')
    .action((name: string) => {
      if (getOrgByName(getRawDb(), name)) {
        console.error(`Error: org '${name}' already exists`)
        process.exit(1)
      }
      const org = createOrg(getRawDb(), name, 'team')
      console.log(`Created org '${org.name}' (id ${org.id}, kind ${org.kind}).`)
    })

  cmd
    .command('list <username>')
    .description('List orgs a user belongs to')
    .action((username: string) => {
      const user = resolveUserOrExit(username)
      const orgs = listOrgsForUser(getRawDb(), user.id)
      if (orgs.length === 0) {
        console.log(`User '${username}' belongs to no orgs.`)
        return
      }
      console.log(`${'Org'.padEnd(20)}  ${'Kind'.padEnd(10)}  Role`)
      for (const o of orgs) console.log(`${o.name.padEnd(20)}  ${o.kind.padEnd(10)}  ${o.role}`)
    })

  const membersCmd = new Command('members').description('Manage org membership')

  membersCmd
    .command('add <org> <username>')
    .description('Add a user to an org (rejected for personal orgs)')
    .option('--role <role>', 'org_admin | member', 'member')
    .action((orgName: string, username: string, opts: { role: string }) => {
      if (opts.role !== 'org_admin' && opts.role !== 'member') {
        console.error("Error: --role must be 'org_admin' or 'member'")
        process.exit(1)
      }
      const org = resolveOrgOrExit(orgName)
      const user = resolveUserOrExit(username)
      try {
        addOrgMember(getRawDb(), org.id, user.id, opts.role)
        console.log(`Added '${username}' to org '${orgName}' as ${opts.role}.`)
      } catch (e) {
        if (e instanceof PersonalOrgImmutableError) {
          console.error(`Error: ${e.message}`)
          process.exit(1)
        }
        throw e
      }
    })

  membersCmd
    .command('remove <org> <username>')
    .description('Remove a user from an org (rejected for personal orgs)')
    .action((orgName: string, username: string) => {
      const org = resolveOrgOrExit(orgName)
      const user = resolveUserOrExit(username)
      try {
        removeOrgMember(getRawDb(), org.id, user.id)
        console.log(`Removed '${username}' from org '${orgName}'.`)
      } catch (e) {
        if (e instanceof PersonalOrgImmutableError) {
          console.error(`Error: ${e.message}`)
          process.exit(1)
        }
        throw e
      }
    })

  membersCmd
    .command('list <org>')
    .description('List members of an org')
    .action((orgName: string) => {
      const org = resolveOrgOrExit(orgName)
      const members = listOrgMembers(getRawDb(), org.id)
      if (members.length === 0) {
        console.log(`Org '${orgName}' has no members.`)
        return
      }
      console.log(`${'User ID'.padEnd(10)}  Role`)
      for (const m of members) console.log(`${String(m.userId).padEnd(10)}  ${m.role}`)
    })

  cmd.addCommand(membersCmd)

  return cmd
}

export function usersCommand(): Command {
  const cmd = new Command('users').description('Manage user accounts (Phase 123)')

  cmd
    .command('create <username>')
    .description('Create a new user and optionally add them to an org')
    .option('--password <password>', 'password (prompted if omitted is not supported here; required for non-interactive use)')
    .option('--org <org>', 'org to add the new user to (in addition to their auto-provisioned personal org)')
    .option('--role <role>', 'role within --org: org_admin | member', 'member')
    .action((username: string, opts: { password?: string; org?: string; role: string }) => {
      if (!opts.password) {
        console.error('Error: --password is required (use `gitsema auth create-user` for an interactive prompt)')
        process.exit(1)
      }
      const rawDb = getRawDb()
      const user = createUser(rawDb, username, opts.password)
      maybeProvisionPersonalOrg(rawDb, user.id, user.username)
      console.log(`Created user '${user.username}' (id ${user.id}).`)
      if (opts.org) {
        if (opts.role !== 'org_admin' && opts.role !== 'member') {
          console.error("Error: --role must be 'org_admin' or 'member'")
          process.exit(1)
        }
        const org = resolveOrgOrExit(opts.org)
        addOrgMember(rawDb, org.id, user.id, opts.role)
        console.log(`Added '${username}' to org '${opts.org}' as ${opts.role}.`)
      }
    })

  cmd
    .command('list')
    .description('List all users')
    .action(() => {
      const rows = getRawDb()
        .prepare('SELECT id, username, created_at FROM users ORDER BY created_at ASC')
        .all() as Array<{ id: number; username: string; created_at: number }>
      if (rows.length === 0) {
        console.log('No users. Use: gitsema users create <username> --password <password>')
        return
      }
      console.log(`${'ID'.padEnd(8)}  ${'Username'.padEnd(20)}  Created`)
      for (const r of rows) {
        const created = new Date(r.created_at * 1000).toISOString().slice(0, 10)
        console.log(`${String(r.id).padEnd(8)}  ${r.username.padEnd(20)}  ${created}`)
      }
    })

  return cmd
}
