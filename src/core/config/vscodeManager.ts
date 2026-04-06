/**
 * VS Code integration manager — installs and uninstalls gitsema's MCP server
 * and LSP server entries in VS Code configuration files.
 *
 * MCP:  writes the `"gitsema"` entry into the `servers` block of `mcp.json`.
 * LSP:  writes `gitsema.lsp.*` keys into `settings.json` for consumption by
 *       a gitsema VS Code extension or a generic LSP client extension.
 *
 * Scopes:
 *   local   <cwd>/.vscode/mcp.json | <cwd>/.vscode/settings.json
 *   global  <vscode-user-dir>/mcp.json | <vscode-user-dir>/settings.json
 *
 * VS Code user-config directory:
 *   Windows  %APPDATA%\Code\User
 *   macOS    ~/Library/Application Support/Code/User
 *   Linux    $XDG_CONFIG_HOME/Code/User  (default ~/.config/Code/User)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// ---------------------------------------------------------------------------
// Result type (mirrors HookInstallResult from hookManager)
// ---------------------------------------------------------------------------

export interface VscodeInstallResult {
  installed: string[]
  skipped: string[]
  removed: string[]
  errors: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves the gitsema package root (same technique as hookManager). */
function getPackageRoot(): string {
  const requireFn = createRequire(import.meta.url)
  try {
    const pkgPath = requireFn.resolve('../../package.json')
    return dirname(pkgPath)
  } catch {
    const thisFile = fileURLToPath(import.meta.url)
    return join(dirname(thisFile), '..', '..', '..')
  }
}

/** Absolute path to the compiled CLI entry point. */
function getCliPath(): string {
  return join(getPackageRoot(), 'dist', 'cli', 'index.js')
}

/** Platform-specific VS Code user-config directory. */
function getVSCodeUserDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    return join(appData, 'Code', 'User')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Code', 'User')
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(xdgConfig, 'Code', 'User')
}

/** Resolves the target directory for the given scope. */
function getVSCodeDir(scope: 'local' | 'global', cwd: string): string {
  return scope === 'global' ? getVSCodeUserDir() : join(cwd, '.vscode')
}

/** Reads and parses a JSON file; returns `{}` if absent or unparseable. */
function readJson(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

/** Writes a JSON file (2-space indent), creating parent directories as needed. */
function writeJson(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

const MCP_SERVER_KEY = 'gitsema'

/**
 * Installs the gitsema MCP server entry into `mcp.json` for the given scope.
 *
 * If the `"gitsema"` key is already present the file is left untouched and
 * the path is recorded in `skipped`.
 */
export function installVSCodeMcp(
  scope: 'local' | 'global',
  cwd: string = process.cwd(),
): VscodeInstallResult {
  const result: VscodeInstallResult = { installed: [], skipped: [], removed: [], errors: [] }
  const mcpPath = join(getVSCodeDir(scope, cwd), 'mcp.json')

  try {
    const data = readJson(mcpPath) as { servers?: Record<string, unknown>; inputs?: unknown[] }
    if (!data.servers) data.servers = {}
    if (!data.inputs) data.inputs = []

    if (data.servers[MCP_SERVER_KEY]) {
      result.skipped.push(mcpPath)
      return result
    }

    data.servers[MCP_SERVER_KEY] = {
      type: 'stdio',
      command: 'node',
      args: [getCliPath(), 'tools', 'mcp'],
    }

    writeJson(mcpPath, data)
    result.installed.push(mcpPath)
  } catch (err) {
    result.errors.push(`Failed to install MCP config: ${(err as Error).message}`)
  }

  return result
}

/**
 * Removes the `"gitsema"` MCP server entry from `mcp.json`.
 *
 * Leaves the file intact if the key is absent.
 */
export function uninstallVSCodeMcp(
  scope: 'local' | 'global',
  cwd: string = process.cwd(),
): VscodeInstallResult {
  const result: VscodeInstallResult = { installed: [], skipped: [], removed: [], errors: [] }
  const mcpPath = join(getVSCodeDir(scope, cwd), 'mcp.json')

  if (!existsSync(mcpPath)) {
    result.skipped.push(mcpPath)
    return result
  }

  try {
    const data = readJson(mcpPath) as { servers?: Record<string, unknown> }

    if (!data.servers?.[MCP_SERVER_KEY]) {
      result.skipped.push(mcpPath)
      return result
    }

    delete data.servers[MCP_SERVER_KEY]
    writeJson(mcpPath, data)
    result.removed.push(mcpPath)
  } catch (err) {
    result.errors.push(`Failed to uninstall MCP config: ${(err as Error).message}`)
  }

  return result
}

// ---------------------------------------------------------------------------
// LSP
// ---------------------------------------------------------------------------

const LSP_SETTINGS_KEYS = ['gitsema.lsp.enabled', 'gitsema.lsp.command', 'gitsema.lsp.args'] as const

/**
 * Installs gitsema LSP configuration into `settings.json`.
 *
 * Writes `gitsema.lsp.enabled`, `gitsema.lsp.command`, and `gitsema.lsp.args`
 * for consumption by a gitsema VS Code extension or a generic LSP client.
 */
export function installVSCodeLsp(
  scope: 'local' | 'global',
  cwd: string = process.cwd(),
): VscodeInstallResult {
  const result: VscodeInstallResult = { installed: [], skipped: [], removed: [], errors: [] }
  const settingsPath = join(getVSCodeDir(scope, cwd), 'settings.json')

  try {
    const data = readJson(settingsPath)

    if (data['gitsema.lsp.enabled']) {
      result.skipped.push(settingsPath)
      return result
    }

    data['gitsema.lsp.enabled'] = true
    data['gitsema.lsp.command'] = 'node'
    data['gitsema.lsp.args'] = [getCliPath(), 'tools', 'lsp']

    writeJson(settingsPath, data)
    result.installed.push(settingsPath)
  } catch (err) {
    result.errors.push(`Failed to install LSP config: ${(err as Error).message}`)
  }

  return result
}

/**
 * Removes gitsema LSP keys from `settings.json`.
 */
export function uninstallVSCodeLsp(
  scope: 'local' | 'global',
  cwd: string = process.cwd(),
): VscodeInstallResult {
  const result: VscodeInstallResult = { installed: [], skipped: [], removed: [], errors: [] }
  const settingsPath = join(getVSCodeDir(scope, cwd), 'settings.json')

  if (!existsSync(settingsPath)) {
    result.skipped.push(settingsPath)
    return result
  }

  try {
    const data = readJson(settingsPath)

    if (!data['gitsema.lsp.enabled']) {
      result.skipped.push(settingsPath)
      return result
    }

    for (const key of LSP_SETTINGS_KEYS) delete data[key]
    writeJson(settingsPath, data)
    result.removed.push(settingsPath)
  } catch (err) {
    result.errors.push(`Failed to uninstall LSP config: ${(err as Error).message}`)
  }

  return result
}
