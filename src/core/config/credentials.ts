/**
 * Local credential storage for `gitsema auth` (Phase 122 / multi-tenant-auth
 * §4.1). Following the existing precedent set by configManager.ts (config
 * values are already stored in plaintext in `.gitsema/config.json` /
 * `~/.config/gitsema/config.json` — there is no prior OS-keychain
 * integration in this codebase to extend), the session token / active API
 * key is stored the same way, in a separate `credentials.json` written with
 * 0o600 permissions (tightened relative to config.json, since this file
 * holds a bearer credential rather than a model name or URL).
 *
 * Only one active login is tracked at a time, mirroring how `gitsema
 * config` tracks a single active value per key rather than a list.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface StoredCredentials {
  serverUrl: string
  token: string
  username: string
}

function credentialsPath(): string {
  return join(homedir(), '.config', 'gitsema', 'credentials.json')
}

export function readCredentials(): StoredCredentials | undefined {
  const path = credentialsPath()
  if (!existsSync(path)) return undefined
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>
    if (!parsed.serverUrl || !parsed.token || !parsed.username) return undefined
    return { serverUrl: parsed.serverUrl, token: parsed.token, username: parsed.username }
  } catch {
    return undefined
  }
}

export function writeCredentials(creds: StoredCredentials): void {
  const path = credentialsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(creds, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
}

export function clearCredentials(): void {
  const path = credentialsPath()
  if (existsSync(path)) unlinkSync(path)
}
