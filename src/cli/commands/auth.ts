/**
 * `gitsema auth` — identity & credentials CLI (Phase 122 / multi-tenant-auth
 * §5 Phase A). Talks to a remote `gitsema tools serve` server's
 * `/api/v1/auth/*` routes; the local credential file
 * (`~/.config/gitsema/credentials.json`) tracks one active login at a time.
 */

import { Command } from 'commander'
import { createInterface } from 'node:readline'
import { readCredentials, writeCredentials, clearCredentials } from '../../core/config/credentials.js'
import { createUser } from '../../core/auth/identity.js'
import { maybeProvisionPersonalOrg } from '../../core/auth/orgs.js'
import { getRawDb } from '../../core/db/sqlite.js'

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close()
      resolve(answer)
    })
  })
}

/** Parses a duration string like "30d", "12h", "45m", "90s" into seconds. */
function parseDuration(value: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(value.trim())
  if (!match) {
    throw new Error(`Invalid duration '${value}' — expected a number followed by s|m|h|d, e.g. "30d"`)
  }
  const n = parseInt(match[1], 10)
  const unit = match[2]
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1
  return n * multiplier
}

function requireLogin(): { serverUrl: string; token: string; username: string } {
  const creds = readCredentials()
  if (!creds) {
    console.error('Not logged in. Use: gitsema auth login <server-url>')
    process.exit(1)
  }
  return creds
}

async function apiRequest<T>(
  serverUrl: string,
  method: string,
  path: string,
  token: string | undefined,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/auth${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) {
    throw new Error(`Server error ${res.status}: ${json.error ?? text}`)
  }
  return json as T
}

export function authCommand(): Command {
  const cmd = new Command('auth').description('Manage gitsema server identity & credentials')

  cmd
    .command('login <server-url>')
    .description('Log in to a gitsema server (prompts for username/password)')
    .action(async (serverUrl: string) => {
      const username = await prompt('Username: ')
      const password = await prompt('Password: ')
      try {
        const result = await apiRequest<{ token: string; expiresAt: number; username: string }>(
          serverUrl,
          'POST',
          '/login',
          undefined,
          { username, password },
        )
        writeCredentials({ serverUrl, token: result.token, username: result.username })
        console.log(`Logged in as '${result.username}' on ${serverUrl}`)
      } catch (e) {
        console.error(`Login failed: ${e instanceof Error ? e.message : String(e)}`)
        process.exit(1)
      }
    })

  cmd
    .command('logout')
    .description('Log out and clear stored credentials')
    .action(async () => {
      const creds = readCredentials()
      if (!creds) {
        console.log('Not logged in.')
        return
      }
      try {
        await apiRequest(creds.serverUrl, 'POST', '/logout', creds.token)
      } catch {
        // best-effort: clear local credentials even if the server is unreachable
      }
      clearCredentials()
      console.log('Logged out.')
    })

  cmd
    .command('whoami')
    .description('Show the currently logged-in user')
    .action(async () => {
      const creds = requireLogin()
      try {
        const result = await apiRequest<{ id: number; username: string; createdAt: number }>(
          creds.serverUrl,
          'GET',
          '/whoami',
          creds.token,
        )
        console.log(`${result.username} (id ${result.id}) on ${creds.serverUrl}`)
      } catch (e) {
        console.error(`whoami failed: ${e instanceof Error ? e.message : String(e)}`)
        process.exit(1)
      }
    })

  const tokenCmd = new Command('token').description('Manage your own API keys on the logged-in server')

  tokenCmd
    .command('create')
    .description('Mint a new API key for the logged-in user')
    .option('--label <label>', 'descriptive label for the key')
    .option('--expires <duration>', 'hard expiry, e.g. "30d", "12h" (default: never expires)')
    .action(async (opts: { label?: string; expires?: string }) => {
      const creds = requireLogin()
      let expiresInSeconds: number | undefined
      if (opts.expires) {
        try {
          expiresInSeconds = parseDuration(opts.expires)
        } catch (e) {
          console.error(String(e instanceof Error ? e.message : e))
          process.exit(1)
        }
      }
      try {
        const result = await apiRequest<{ token: string; prefix: string; expiresAt: number | null }>(
          creds.serverUrl,
          'POST',
          '/tokens',
          creds.token,
          { label: opts.label, expiresInSeconds },
        )
        console.log(`API key minted:`)
        console.log(`  ${result.token}`)
        if (opts.label) console.log(`  Label: ${opts.label}`)
        if (result.expiresAt) console.log(`  Expires: ${new Date(result.expiresAt * 1000).toISOString()}`)
        console.log(`\nCopy this token now — it cannot be recovered. Use it as:`)
        console.log(`  Authorization: Bearer ${result.token}`)
      } catch (e) {
        console.error(`Token creation failed: ${e instanceof Error ? e.message : String(e)}`)
        process.exit(1)
      }
    })

  tokenCmd
    .command('list')
    .description('List your API keys on the logged-in server')
    .action(async () => {
      const creds = requireLogin()
      try {
        const result = await apiRequest<{
          keys: Array<{ keyPrefix: string; label: string | null; createdAt: number; expiresAt: number | null; revokedAt: number | null }>
        }>(creds.serverUrl, 'GET', '/tokens', creds.token)
        if (result.keys.length === 0) {
          console.log('No API keys minted. Use: gitsema auth token create')
          return
        }
        console.log(`${'Prefix'.padEnd(12)}  ${'Label'.padEnd(20)}  ${'Created'.padEnd(12)}  Status`)
        for (const k of result.keys) {
          const created = new Date(k.createdAt * 1000).toISOString().slice(0, 10)
          const status = k.revokedAt ? 'revoked' : k.expiresAt && k.expiresAt <= Date.now() / 1000 ? 'expired' : 'active'
          console.log(`${(k.keyPrefix + '...').padEnd(12)}  ${(k.label ?? '-').padEnd(20)}  ${created.padEnd(12)}  ${status}`)
        }
      } catch (e) {
        console.error(`Listing tokens failed: ${e instanceof Error ? e.message : String(e)}`)
        process.exit(1)
      }
    })

  tokenCmd
    .command('revoke <prefix>')
    .description('Revoke one of your API keys by its prefix')
    .action(async (prefix: string) => {
      const creds = requireLogin()
      try {
        const result = await apiRequest<{ revoked: number }>(
          creds.serverUrl,
          'DELETE',
          `/tokens/${encodeURIComponent(prefix)}`,
          creds.token,
        )
        console.log(`Revoked ${result.revoked} key(s) with prefix '${prefix}'.`)
      } catch (e) {
        console.error(`Revoke failed: ${e instanceof Error ? e.message : String(e)}`)
        process.exit(1)
      }
    })

  cmd.addCommand(tokenCmd)

  cmd
    .command('create-user <username>')
    .description('Bootstrap a new user directly against the local server DB (operator-only; requires local DB access, same model as `repos token add`)')
    .action(async (username: string) => {
      const password = await prompt('Password: ')
      const confirm = await prompt('Confirm password: ')
      if (password !== confirm) {
        console.error('Error: passwords do not match')
        process.exit(1)
      }
      try {
        const user = createUser(getRawDb(), username, password)
        maybeProvisionPersonalOrg(getRawDb(), user.id, user.username)
        console.log(`Created user '${user.username}' (id ${user.id}).`)
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`)
        process.exit(1)
      }
    })

  return cmd
}
