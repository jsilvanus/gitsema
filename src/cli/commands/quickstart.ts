/**
 * `gitsema quickstart` — guided onboarding wizard.
 *
 * Walks a new user through:
 * 1. Detecting the current Git repository
 * 2. Detecting available embedding providers (Ollama / HTTP)
 * 3. Selecting a model
 * 4. Optionally writing the config
 * 5. Running `gitsema index start` on HEAD to get a working index quickly
 *
 * Designed to get a new user from zero to first search result in < 5 minutes.
 */

import * as readline from 'node:readline'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setConfigValue, getLocalConfigPath } from '../../core/config/configManager.js'
import { indexStartCommand } from './index.js'

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve))
}

function step(n: number, total: number, msg: string): void {
  console.log(`\n[${n}/${total}] ${msg}`)
}

export async function quickstartCommand(): Promise<void> {
  const TOTAL_STEPS = 5
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║        gitsema quickstart wizard                 ║')
  console.log('║  Get semantic search over your repo in minutes.  ║')
  console.log('╚══════════════════════════════════════════════════╝')

  // Step 1: Detect Git repo
  step(1, TOTAL_STEPS, 'Detecting Git repository…')
  let repoRoot: string
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    console.log(`  ✓ Git repo found: ${repoRoot}`)
  } catch {
    console.error('  ✗ Not a Git repository. Run from inside a Git repo.')
    rl.close()
    process.exit(1)
  }

  const dbPath = join(repoRoot, '.gitsema', 'index.db')
  const alreadyIndexed = existsSync(dbPath)
  if (alreadyIndexed) {
    console.log(`  ℹ  Index DB already exists: ${dbPath}`)
  }

  // Step 2: Detect provider
  step(2, TOTAL_STEPS, 'Detecting embedding provider…')
  let providerType = process.env.GITSEMA_PROVIDER ?? ''
  let modelName = process.env.GITSEMA_MODEL ?? ''

  if (!providerType) {
    // Try Ollama (check if the API responds without using shell)
    let ollamaOk = false
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)
      const resp = await fetch('http://localhost:11434/api/tags', { signal: controller.signal })
      clearTimeout(timeout)
      ollamaOk = resp.ok
    } catch { /* not running or network error */ }

    if (ollamaOk) {
      console.log('  ✓ Ollama detected at http://localhost:11434')
      providerType = 'ollama'
      if (!modelName) modelName = 'nomic-embed-text'
    } else {
      console.log('  ℹ  Ollama not running. Will use HTTP provider.')
      providerType = 'http'
    }
  } else {
    console.log(`  ✓ Using provider from env: ${providerType}`)
  }

  // Step 3: Confirm / pick model
  step(3, TOTAL_STEPS, 'Selecting embedding model…')
  const defaultModel = modelName || (providerType === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small')
  const pickedModel = (await prompt(rl, `  Model [${defaultModel}]: `)).trim() || defaultModel

  let httpUrl = process.env.GITSEMA_HTTP_URL ?? ''
  if (providerType === 'http' && !httpUrl) {
    httpUrl = (await prompt(rl, '  HTTP provider URL (e.g. https://api.openai.com): ')).trim()
    if (!httpUrl) {
      console.error('  ✗ HTTP URL is required for http provider.')
      rl.close(); process.exit(1)
    }
  }

  // Step 4: Write config
  step(4, TOTAL_STEPS, `Writing config to ${getLocalConfigPath(repoRoot)}…`)
  try {
    setConfigValue('provider', providerType, 'local', repoRoot)
    setConfigValue('model', pickedModel, 'local', repoRoot)
    if (httpUrl) setConfigValue('httpUrl', httpUrl, 'local', repoRoot)
    console.log('  ✓ Config saved.')
  } catch (err) {
    console.warn(`  ⚠  Could not save config: ${err instanceof Error ? err.message : String(err)}`)
  }
  rl.close()

  // Step 5: Index HEAD
  step(5, TOTAL_STEPS, 'Indexing HEAD (file-level, this may take a few minutes)…')
  process.env.GITSEMA_PROVIDER = providerType
  process.env.GITSEMA_MODEL = pickedModel
  if (httpUrl) process.env.GITSEMA_HTTP_URL = httpUrl

  try {
    await indexStartCommand({
      since: 'HEAD',
      maxCommits: '1',
      concurrency: '4',
    })
    console.log('\n✓ Done! You can now search your code:')
    console.log('    gitsema search "your concept here"')
    console.log('    gitsema repl')
    console.log('    gitsema status')
    console.log('\nTo index full history: gitsema index start')
  } catch (err) {
    console.error(`\n✗ Indexing failed: ${err instanceof Error ? err.message : String(err)}`)
    console.log('  Check your provider is running and the model is available.')
    console.log('  Then run: gitsema index start')
  }
}
