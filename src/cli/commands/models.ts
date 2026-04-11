/**
 * `gitsema models` — manage embedding model configurations.
 *
 * Subcommands:
 *   models list                               List all configured and indexed models
 *   models info <name>                        Show detailed info for a model
 *   models add <name> [options]               Configure provider settings for a model
 *   models remove <name> [options]            Remove a model's configuration
 *
 * Model profiles are stored under `models.<name>` in `.gitsema/config.json`
 * (local, default) or `~/.config/gitsema/config.json` (global, with --global).
 * Per-model settings override the global GITSEMA_PROVIDER / GITSEMA_HTTP_URL /
 * GITSEMA_API_KEY environment variables, allowing different models to use
 * different providers.
 *
 * Example:
 *   gitsema models add text-embedding-3-small \
 *     --provider http \
 *     --url https://api.openai.com \
 *     --key sk-... \
 *     --set-text
 */

import {
  getModelProfile,
  setModelProfile,
  unsetModelProfile,
  listModelProfiles,
  setConfigValue,
  getGlobalConfigPath,
  getLocalConfigPath,
  type ModelProfile,
  type ConfigScope,
} from '../../core/config/configManager.js'
import { ensureModelDownloadedAndOptimized } from '../../core/embedding/embedeer.js'

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

function validateModelName(modelName: string): void {
  if (!modelName || !modelName.trim()) {
    console.error('Error: model name is required')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// models list
// ---------------------------------------------------------------------------

export interface ModelsListOptions {
  json?: boolean
}

export async function modelsListCommand(options: ModelsListOptions = {}): Promise<void> {
  // Configured profiles (from config files)
  const profiles = listModelProfiles()

  // Try to read indexed models from DB (embed_config table)
  type IndexedModel = {
    model: string
    provider: string
    dimensions: number
    chunker: string
    fileBlobsEmbedded: number
    lastUsedAt: number | null
  }
  const indexedModels: IndexedModel[] = []
  try {
    const { getRawDb } = await import('../../core/db/sqlite.js')
    const rawDb = getRawDb()
    const configTableExists =
      (rawDb.prepare(
        `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='embed_config'`,
      ).get() as { c: number })?.c > 0

    if (configTableExists) {
      const rows = rawDb
        .prepare(
          `SELECT model, provider, dimensions, chunker, last_used_at
           FROM embed_config
           ORDER BY COALESCE(last_used_at, created_at) DESC`,
        )
        .all() as Array<{
          model: string
          provider: string
          dimensions: number
          chunker: string
          last_used_at: number | null
        }>
      for (const r of rows) {
        const fileBlobsRow = rawDb
          .prepare('SELECT COUNT(DISTINCT blob_hash) AS n FROM embeddings WHERE model = ?')
          .get(r.model) as { n: number }
        indexedModels.push({
          model: r.model,
          provider: r.provider,
          dimensions: r.dimensions,
          chunker: r.chunker,
          fileBlobsEmbedded: fileBlobsRow?.n ?? 0,
          lastUsedAt: r.last_used_at,
        })
      }
    }
  } catch {
    // DB may not exist — that's fine, we'll show config-only models
  }

  if (options.json) {
    const profileMap = new Map(profiles.map((p) => [p.name, p]))
    const indexedMap = new Map(indexedModels.map((m) => [m.model, m]))
    const allNames = new Set([...profileMap.keys(), ...indexedMap.keys()])
    const out = Array.from(allNames).sort().map((name) => ({
      name,
      profile: profileMap.get(name)?.profile ?? null,
      profileScope: profileMap.get(name)?.scope ?? null,
      indexed: indexedMap.get(name) ?? null,
    }))
    console.log(JSON.stringify(out, null, 2))
    return
  }

  // Build a unified set of model names
  const profileMap = new Map(profiles.map((p) => [p.name, p]))
  const indexedMap = new Map(indexedModels.map((m) => [m.model, m]))
  const allNames = Array.from(new Set([...profileMap.keys(), ...indexedMap.keys()])).sort()

  if (allNames.length === 0) {
    console.log('No models configured or indexed.')
    console.log('')
    console.log('Add a model profile:  gitsema models add <name> [--provider ollama|http]')
    console.log('Start indexing:       gitsema index start')
    return
  }

  const nameWidth = Math.max(5, ...allNames.map((n) => n.length))
  const provWidth = 8
  // Compute the max width for the "→ global" column (empty string when no alias)
  const globalNameWidth = Math.max(
    0,
    ...allNames.map((n) => {
      const gn = profileMap.get(n)?.profile?.globalName
      return gn ? gn.length + 2 : 0 // "+2" for "→ " prefix
    }),
  )
  const showGlobalCol = globalNameWidth > 0

  const header = `${'Model'.padEnd(nameWidth)}  ${showGlobalCol ? `${'→ Global name'.padEnd(globalNameWidth)}  ` : ''}${'Provider'.padEnd(provWidth)}  Dims   Chunker   Blobs indexed  Scope   Last used`
  console.log(header)
  const sepWidth = nameWidth + 2 + (showGlobalCol ? globalNameWidth + 2 : 0) + provWidth + 2 + 6 + 2 + 9 + 2 + 15 + 2 + 7 + 2 + 10
  console.log('-'.repeat(sepWidth))

  for (const name of allNames) {
    const p = profileMap.get(name)
    const idx = indexedMap.get(name)

    const globalName = p?.profile?.globalName
    const provider = p?.profile?.provider ?? idx?.provider ?? '(default)'
    const dims = idx ? String(idx.dimensions) : '—'
    const chunker = idx?.chunker ?? '—'
    const blobs = idx ? idx.fileBlobsEmbedded.toLocaleString() : '—'
    const scope = p ? p.scope : '—'
    const lastUsed = idx?.lastUsedAt
      ? new Date(idx.lastUsedAt * 1000).toISOString().slice(0, 10)
      : '—'

    const globalCol = showGlobalCol
      ? `${(globalName ? `→ ${globalName}` : '').padEnd(globalNameWidth)}  `
      : ''
    const row =
      name.padEnd(nameWidth) + '  ' +
      globalCol +
      provider.padEnd(provWidth) + '  ' +
      dims.padStart(4) + '   ' +
      chunker.padEnd(9) + ' ' +
      blobs.padStart(14) + '  ' +
      scope.padEnd(6) + '  ' +
      lastUsed
    console.log(row)
  }
  console.log('')
  console.log(`${allNames.length} model(s) total.`)
}

// ---------------------------------------------------------------------------
// models info
// ---------------------------------------------------------------------------

export async function modelsInfoCommand(modelName: string): Promise<void> {
  validateModelName(modelName)

  // Config profile
  const profile = getModelProfile(modelName)
  const profileEntries = Object.entries(profile).filter(([, v]) => v !== undefined)

  console.log(`Model: ${modelName}`)
  if (profile.globalName !== undefined) {
    console.log(`  (shorthand for: ${profile.globalName})`)
  }
  console.log('')

  if (profileEntries.length > 0) {
    console.log('Configured profile:')
    for (const [key, value] of profileEntries) {
      const display = key === 'apiKey' ? '(set — hidden)' : JSON.stringify(value)
      console.log(`  ${key}: ${display}`)
    }
  } else {
    console.log('No profile configured (using global defaults).')
    console.log(`  Run: gitsema models add ${modelName} --provider ollama|http [--url ...] [--key ...]`)
  }

  console.log('')

  // DB info
  try {
    const { getRawDb } = await import('../../core/db/sqlite.js')
    const rawDb = getRawDb()

    const configTableExists =
      (rawDb.prepare(
        `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='embed_config'`,
      ).get() as { c: number })?.c > 0

    if (configTableExists) {
      const rows = rawDb
        .prepare(
          `SELECT provider, dimensions, chunker, window_size, overlap, created_at, last_used_at
           FROM embed_config WHERE model = ? ORDER BY created_at ASC`,
        )
        .all(modelName) as Array<{
          provider: string
          dimensions: number
          chunker: string
          window_size: number | null
          overlap: number | null
          created_at: number
          last_used_at: number | null
        }>

      if (rows.length > 0) {
        console.log(`Index records (${rows.length} config snapshot(s)):`)
        for (const r of rows) {
          const fileBlobsRow = rawDb
            .prepare('SELECT COUNT(DISTINCT blob_hash) AS n FROM embeddings WHERE model = ?')
            .get(modelName) as { n: number }
          const chunkRow = rawDb
            .prepare('SELECT COUNT(*) AS n FROM chunk_embeddings WHERE model = ?')
            .get(modelName) as { n: number }
          console.log(`  Provider:      ${r.provider}`)
          console.log(`  Dimensions:    ${r.dimensions}`)
          console.log(`  Chunker:       ${r.chunker}${r.window_size ? ` (window=${r.window_size}, overlap=${r.overlap ?? 0})` : ''}`)
          console.log(`  Blobs indexed: ${(fileBlobsRow?.n ?? 0).toLocaleString()} (file level)`)
          if ((chunkRow?.n ?? 0) > 0) {
            console.log(`  Chunks:        ${(chunkRow.n).toLocaleString()}`)
          }
          const createdStr = new Date(r.created_at * 1000).toISOString().slice(0, 10)
          console.log(`  First used:    ${createdStr}`)
          if (r.last_used_at) {
            const lastStr = new Date(r.last_used_at * 1000).toISOString().slice(0, 10)
            console.log(`  Last used:     ${lastStr}`)
          }
        }
      } else {
        console.log(`Not yet indexed. Run: gitsema index start`)
      }
    } else {
      console.log('No index found. Run: gitsema index start')
    }
  } catch {
    console.log('Index not available.')
  }
}

// ---------------------------------------------------------------------------
// models add
// ---------------------------------------------------------------------------

export interface ModelsAddOptions {
  globalName?: string
  provider?: string
  url?: string
  key?: string
  level?: string
  setDefault?: boolean
  setText?: boolean
  setCode?: boolean
  global?: boolean
  /** Prefix for code file document embeddings, e.g. "search_document:" */
  prefixCode?: string
  /** Prefix for text/prose file document embeddings, e.g. "search_document:" */
  prefixText?: string
  /** Prefix for search query embeddings, e.g. "search_query:" */
  prefixQuery?: string
  /** Prefix for files in the "other" category (not code or text), e.g. "search_document:" */
  prefixOther?: string
  /**
   * User-defined role prefixes as "role=prefix" strings.
   * May be specified multiple times, e.g. ["jupyter=search_document:", "proto=code:"]
   */
  prefixType?: string[]
  /**
   * Custom extension-to-role mappings as "ext=role" strings.
   * May be specified multiple times, e.g. [".ipynb=jupyter", ".proto=code"]
   */
  extRole?: string[]
}

// ---------------------------------------------------------------------------
// Shared helper: build profile fields from prefix/extRole flags
// ---------------------------------------------------------------------------

function buildPrefixProfile(options: ModelsAddOptions): ModelProfile {
  const profile: ModelProfile = {}

  const prefixes: Record<string, string> = {}
  if (options.prefixCode !== undefined) prefixes['code'] = options.prefixCode
  if (options.prefixText !== undefined) prefixes['text'] = options.prefixText
  if (options.prefixQuery !== undefined) prefixes['query'] = options.prefixQuery
  if (options.prefixOther !== undefined) prefixes['other'] = options.prefixOther

  for (const entry of options.prefixType ?? []) {
    const eqIdx = entry.indexOf('=')
    if (eqIdx < 1) {
      console.error(`Error: --prefix-type value must be in "role=prefix" format, got: ${entry}`)
      process.exit(1)
    }
    const role = entry.slice(0, eqIdx).trim()
    const prefix = entry.slice(eqIdx + 1)
    prefixes[role] = prefix
  }

  if (Object.keys(prefixes).length > 0) profile.prefixes = prefixes

  const extRoles: Record<string, string> = {}
  for (const entry of options.extRole ?? []) {
    const eqIdx = entry.indexOf('=')
    if (eqIdx < 1) {
      console.error(`Error: --ext-role value must be in "ext=role" format, got: ${entry}`)
      process.exit(1)
    }
    let ext = entry.slice(0, eqIdx).trim().toLowerCase()
    if (!ext.startsWith('.')) ext = `.${ext}`
    const role = entry.slice(eqIdx + 1).trim()
    extRoles[ext] = role
  }

  if (Object.keys(extRoles).length > 0) profile.extRoles = extRoles

  return profile
}

function printProfile(profile: ModelProfile): void {
  if (profile.globalName !== undefined) console.log(`  globalName: ${JSON.stringify(profile.globalName)}`)
  if (profile.provider !== undefined) console.log(`  provider: ${profile.provider}`)
  if (profile.httpUrl !== undefined) console.log(`  httpUrl: ${JSON.stringify(profile.httpUrl)}`)
  if (profile.apiKey !== undefined) console.log(`  apiKey: (hidden)`)
  if (profile.level !== undefined) console.log(`  level: ${profile.level}`)
  if (profile.prefixes !== undefined) console.log(`  prefixes: ${JSON.stringify(profile.prefixes)}`)
  if (profile.extRoles !== undefined) console.log(`  extRoles: ${JSON.stringify(profile.extRoles)}`)
}

export async function modelsAddCommand(
  modelName: string,
  options: ModelsAddOptions,
): Promise<void> {
  validateModelName(modelName)

  const scope: ConfigScope = options.global ? 'global' : 'local'
  const filePath = scope === 'global' ? getGlobalConfigPath() : getLocalConfigPath()

  const profile: ModelProfile = buildPrefixProfile(options)
  if (options.globalName !== undefined) profile.globalName = options.globalName
  if (options.provider !== undefined) profile.provider = options.provider
  if (options.url !== undefined) profile.httpUrl = options.url
  if (options.key !== undefined) profile.apiKey = options.key
  if (options.level !== undefined) {
    const validLevels = ['blob', 'file', 'function', 'fixed', 'chunk', 'symbol', 'module']
    if (!validLevels.includes(options.level)) {
      console.error(`Error: --level must be one of: ${validLevels.join(', ')}`)
      process.exit(1)
    }
    profile.level = options.level
  }

  const hasProfileFields = Object.keys(profile).length > 0
  if (!hasProfileFields && !options.setDefault && !options.setText && !options.setCode) {
    console.error('Error: at least one option is required')
    console.error(`Usage: gitsema models add ${modelName} --provider ollama|http [--url <url>] [--key <apikey>]`)
    console.error(`       gitsema models add ${modelName} --global-name <remote-model-id>`)
    console.error(`       gitsema models add ${modelName} --prefix-code "search_document:" --prefix-query "search_query:"`)
    process.exit(1)
  }

  if (options.provider === 'http' && !options.url) {
    const existing = getModelProfile(modelName)
    if (!existing.httpUrl && !process.env.GITSEMA_HTTP_URL) {
      console.error(`Warning: provider=http set but no --url provided. Remember to set it or GITSEMA_HTTP_URL.`)
    }
  }

  if (hasProfileFields) {
    setModelProfile(modelName, profile, scope)
  }

  if (options.setDefault) {
    setConfigValue('model', modelName, scope)
    setConfigValue('textModel', modelName, scope)
    setConfigValue('codeModel', modelName, scope)
  } else {
    if (options.setText) setConfigValue('textModel', modelName, scope)
    if (options.setCode) setConfigValue('codeModel', modelName, scope)
  }

  console.log(`Saved model profile for '${modelName}' in ${scope} config (${filePath}).`)
  if (hasProfileFields) printProfile(profile)
  if (options.setDefault) console.log(`  Set as default model (model + textModel + codeModel).`)
  if (options.setText && !options.setDefault) console.log(`  Set as default text model (textModel).`)
  if (options.setCode && !options.setDefault) console.log(`  Set as default code model (codeModel).`)

  // If the user selected the embedeer provider, attempt to download & optimise the model.
  if ((options.provider === 'embedeer') || (profile.provider === 'embedeer')) {
    try {
      console.log(`embedeer: ensuring model '${modelName}' is downloaded and optimised (this may take a while)...`)
      // Best-effort: download if missing, then optimise.
      // Failures are reported but do not prevent the profile from being saved.
      // eslint-disable-next-line no-await-in-loop
      await ensureModelDownloadedAndOptimized(modelName, { downloadIfMissing: true, optimize: true })
      console.log('embedeer: model setup complete.')
    } catch (err) {
      console.error(`embedeer: model setup failed: ${err instanceof Error ? err.message : String(err)}`)
      console.error('You can retry manually after installing the embedeer package: npm install @jsilvanus/embedeer')
    }
  }
}

// ---------------------------------------------------------------------------
// models update
// ---------------------------------------------------------------------------

export type ModelsUpdateOptions = ModelsAddOptions

export async function modelsUpdateCommand(
  modelName: string,
  options: ModelsUpdateOptions,
): Promise<void> {
  validateModelName(modelName)

  const scope: ConfigScope = options.global ? 'global' : 'local'
  const filePath = scope === 'global' ? getGlobalConfigPath() : getLocalConfigPath()

  // Warn if no existing profile found in either scope
  const existing = getModelProfile(modelName)
  const hasExisting = Object.values(existing).some((v) => v !== undefined)
  if (!hasExisting) {
    console.log(`Note: no existing profile found for '${modelName}' — creating one.`)
  }

  const profile: ModelProfile = buildPrefixProfile(options)
  if (options.globalName !== undefined) profile.globalName = options.globalName
  if (options.provider !== undefined) profile.provider = options.provider
  if (options.url !== undefined) profile.httpUrl = options.url
  if (options.key !== undefined) profile.apiKey = options.key
  if (options.level !== undefined) {
    const validLevels = ['blob', 'file', 'function', 'fixed', 'chunk', 'symbol', 'module']
    if (!validLevels.includes(options.level)) {
      console.error(`Error: --level must be one of: ${validLevels.join(', ')}`)
      process.exit(1)
    }
    profile.level = options.level
  }

  const hasProfileFields = Object.keys(profile).length > 0
  if (!hasProfileFields && !options.setDefault && !options.setText && !options.setCode) {
    console.error('Error: at least one option is required')
    console.error(`Usage: gitsema models update ${modelName} --global-name <remote-model-id>`)
    console.error(`       gitsema models update ${modelName} --prefix-code "search_document:" --prefix-query "search_query:"`)
    process.exit(1)
  }

  if (hasProfileFields) {
    setModelProfile(modelName, profile, scope)
  }

  if (options.setDefault) {
    setConfigValue('model', modelName, scope)
    setConfigValue('textModel', modelName, scope)
    setConfigValue('codeModel', modelName, scope)
  } else {
    if (options.setText) setConfigValue('textModel', modelName, scope)
    if (options.setCode) setConfigValue('codeModel', modelName, scope)
  }

  console.log(`Updated model profile for '${modelName}' in ${scope} config (${filePath}).`)
  if (hasProfileFields) printProfile(profile)
  if (options.setDefault) console.log(`  Set as default model (model + textModel + codeModel).`)
  if (options.setText && !options.setDefault) console.log(`  Set as default text model (textModel).`)
  if (options.setCode && !options.setDefault) console.log(`  Set as default code model (codeModel).`)

  // If the effective profile uses embedeer, attempt a best-effort optimiser run.
  try {
    const finalProfile = getModelProfile(modelName)
    if (finalProfile.provider === 'embedeer') {
      console.log(`embedeer: running optimisation for model '${modelName}' (this may take a while)...`)
      // eslint-disable-next-line no-await-in-loop
      await ensureModelDownloadedAndOptimized(modelName, { downloadIfMissing: true, optimize: true })
      console.log('embedeer: optimisation complete.')
    }
  } catch (err) {
    console.error(`embedeer: optimisation failed: ${err instanceof Error ? err.message : String(err)}`)
    console.error('You can retry manually after installing the embedeer package: npm install @jsilvanus/embedeer')
  }
}

// ---------------------------------------------------------------------------
// models remove
// ---------------------------------------------------------------------------

export interface ModelsRemoveOptions {
  purgeIndex?: boolean
  yes?: boolean
  global?: boolean
}

export async function modelsRemoveCommand(
  modelName: string,
  options: ModelsRemoveOptions,
): Promise<void> {
  validateModelName(modelName)

  const scope: ConfigScope = options.global ? 'global' : 'local'
  const removed = unsetModelProfile(modelName, scope)

  if (removed) {
    console.log(`Removed model profile for '${modelName}' from ${scope} config.`)
  } else {
    // Try the other scope before reporting not-found
    const otherScope: ConfigScope = scope === 'local' ? 'global' : 'local'
    const otherProfile = getModelProfile(modelName)
    const existsOther = Object.values(otherProfile).some((v) => v !== undefined)
    if (existsOther) {
      console.log(
        `No profile found in ${scope} config for '${modelName}'. ` +
        `It may exist in ${otherScope} config — use --${otherScope} to remove it.`,
      )
    } else {
      console.log(`No profile configured for '${modelName}'.`)
    }
  }

  if (options.purgeIndex) {
    try {
      const { clearModelCommand } = await import('./clearModel.js')
      console.log(`Purging index data for model '${modelName}'...`)
      await clearModelCommand(modelName, { yes: options.yes })
    } catch (err) {
      console.error(`Failed to purge index: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }
}
