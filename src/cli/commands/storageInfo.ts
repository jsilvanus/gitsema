/**
 * `gitsema storage info` (Phase 103).
 *
 * Prints the resolved `storage.*` configuration — which backend/scope/location
 * commands will operate against — without opening any connections. Useful for
 * confirming `storage.backend`/`storage.scope`/`storage.metadata.url`/etc.
 * before running `gitsema index` or `gitsema storage migrate`.
 */

import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'

export async function storageInfoCommand(): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())

  console.log(`Backend:  ${profile.backend}`)
  console.log(`Scope:    ${profile.scope}`)
  console.log(`Location: ${profile.location}`)
  console.log(`FTS:      ${profile.fts ? 'enabled' : 'disabled'}`)

  if (profile.backend !== 'sqlite') {
    console.log('')
    console.log('Run `gitsema status` or `gitsema doctor` for row counts and health checks.')
  }
}
