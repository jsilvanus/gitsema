/**
 * `gitsema config` command — manage persistent configuration at two levels:
 *
 *   global  ~/.config/gitsema/config.json   (user-level defaults)
 *   local   .gitsema/config.json            (repo-level defaults)
 *
 * Subcommands:
 *   config set <key> <value> [--global]    Set a config value
 *   config get <key>                       Show the resolved value (with source)
 *   config list [--global | --local]       List all config entries
 *   config unset <key> [--global]          Remove a config key
 */

import {
  coerceValue,
  getConfigValue,
  getGlobalConfigPath,
  getLocalConfigPath,
  listConfig,
  setConfigValue,
  unsetConfigValue,
  type ConfigScope,
} from '../../core/config/configManager.js'
import { installHooks, uninstallHooks } from '../../core/config/hookManager.js'
import {
  installVSCodeMcp,
  uninstallVSCodeMcp,
  installVSCodeLsp,
  uninstallVSCodeLsp,
} from '../../core/config/vscodeManager.js'

// ---------------------------------------------------------------------------
// Subcommand: set
// ---------------------------------------------------------------------------

export interface ConfigSetOptions {
  global?: boolean
}

export async function configSetCommand(
  key: string,
  rawValue: string,
  options: ConfigSetOptions,
): Promise<void> {
  const scope: ConfigScope = options.global ? 'global' : 'local'
  const value = coerceValue(rawValue)
  setConfigValue(key, value, scope)
  const filePath = scope === 'global' ? getGlobalConfigPath() : getLocalConfigPath()
  console.log(`Set ${scope} ${key} = ${JSON.stringify(value)}  (${filePath})`)

  // Special handling: hooks.enabled toggles Git hook installation
  if (key === 'hooks.enabled') {
    if (value === true) {
      const result = installHooks()
      for (const hook of result.installed) {
        console.log(`  ✔  Installed hook: ${hook}`)
      }
      for (const hook of result.skipped) {
        console.log(`  ⚠  Skipped (already exists): ${hook}`)
      }
      for (const err of result.errors) {
        console.error(`  ✖  ${err}`)
      }
      if (result.errors.length > 0) process.exitCode = 1
    } else {
      const result = uninstallHooks()
      for (const hook of result.removed) {
        console.log(`  ✔  Removed hook: ${hook}`)
      }
      for (const hook of result.skipped) {
        console.log(`  ⚠  Skipped (not a symlink, remove manually): ${hook}`)
      }
      for (const err of result.errors) {
        console.error(`  ✖  ${err}`)
      }
      if (result.errors.length > 0) process.exitCode = 1
    }
  }

  // Special handling: vscode.mcp toggles MCP server entry in VS Code mcp.json
  if (key === 'vscode.mcp') {
    const scope = options.global ? 'global' : 'local'
    if (value === true) {
      const result = installVSCodeMcp(scope)
      for (const f of result.installed) console.log(`  ✔  Installed MCP server entry: ${f}`)
      for (const f of result.skipped)   console.log(`  ⚠  Already present, skipped: ${f}`)
      for (const e of result.errors)    console.error(`  ✖  ${e}`)
      if (result.errors.length > 0) process.exitCode = 1
    } else {
      const result = uninstallVSCodeMcp(scope)
      for (const f of result.removed) console.log(`  ✔  Removed MCP server entry: ${f}`)
      for (const f of result.skipped)  console.log(`  ⚠  Not found, skipped: ${f}`)
      for (const e of result.errors)   console.error(`  ✖  ${e}`)
      if (result.errors.length > 0) process.exitCode = 1
    }
  }

  // Special handling: vscode.lsp toggles LSP config keys in VS Code settings.json
  if (key === 'vscode.lsp') {
    const scope = options.global ? 'global' : 'local'
    if (value === true) {
      const result = installVSCodeLsp(scope)
      for (const f of result.installed) console.log(`  ✔  Installed LSP config: ${f}`)
      for (const f of result.skipped)   console.log(`  ⚠  Already present, skipped: ${f}`)
      for (const e of result.errors)    console.error(`  ✖  ${e}`)
      if (result.errors.length > 0) process.exitCode = 1
    } else {
      const result = uninstallVSCodeLsp(scope)
      for (const f of result.removed) console.log(`  ✔  Removed LSP config: ${f}`)
      for (const f of result.skipped)  console.log(`  ⚠  Not found, skipped: ${f}`)
      for (const e of result.errors)   console.error(`  ✖  ${e}`)
      if (result.errors.length > 0) process.exitCode = 1
    }
  }
}

// ---------------------------------------------------------------------------
// Subcommand: get
// ---------------------------------------------------------------------------

export async function configGetCommand(key: string): Promise<void> {
  const { value, source } = getConfigValue(key)
  if (value === undefined) {
    console.error(`No value set for '${key}'`)
    process.exit(1)
  }
  console.log(`${JSON.stringify(value)}  [${source}]`)
}

// ---------------------------------------------------------------------------
// Subcommand: list
// ---------------------------------------------------------------------------

export interface ConfigListOptions {
  global?: boolean
  local?: boolean
}

export async function configListCommand(options: ConfigListOptions): Promise<void> {
  const entries = listConfig()

  // Optionally filter to a single scope
  const filterScope = options.global ? 'global' : options.local ? 'local' : undefined

  const filtered = filterScope
    ? entries.filter((e) => e.source === filterScope || e.source === 'env')
    : entries

  // Only show entries that have a value
  const active = filtered.filter((e) => e.value !== undefined)

  if (active.length === 0) {
    console.log('No configuration values set.')
    return
  }

  const keyWidth = Math.max(...active.map((e) => e.key.length))
  const srcWidth = 7 // 'default' is longest source label

  console.log(
    `${'Key'.padEnd(keyWidth)}  ${'Value'.padEnd(20)}  Source`,
  )
  console.log('-'.repeat(keyWidth + 2 + 20 + 2 + srcWidth))

  for (const { key, value, source } of active) {
    const valueStr = JSON.stringify(value)
    console.log(`${key.padEnd(keyWidth)}  ${valueStr.padEnd(20)}  ${source}`)
  }
}

// ---------------------------------------------------------------------------
// Subcommand: unset
// ---------------------------------------------------------------------------

export interface ConfigUnsetOptions {
  global?: boolean
}

export async function configUnsetCommand(
  key: string,
  options: ConfigUnsetOptions,
): Promise<void> {
  const scope: ConfigScope = options.global ? 'global' : 'local'
  const existed = unsetConfigValue(key, scope)
  if (!existed) {
    console.error(`Key '${key}' not found in ${scope} config`)
    process.exit(1)
  }
  console.log(`Unset ${scope} ${key}`)
}
