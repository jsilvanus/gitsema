import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const LOG_DIR = '.gitsema'
const LOG_FILE = 'gitsema.log'
const LOG_FILE_OLD = 'gitsema.log.1'
// Rotate when > 1MB by default; can be overridden with env GITSEMA_LOG_MAX_BYTES
const DEFAULT_MAX_BYTES = 1024 * 1024

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    try {
      mkdirSync(LOG_DIR)
    } catch {
      // ignore
    }
  }
}

function rotateIfNeeded(): void {
  try {
    const maxBytes = Number(process.env.GITSEMA_LOG_MAX_BYTES) || DEFAULT_MAX_BYTES
    const path = join(LOG_DIR, LOG_FILE)
    if (!existsSync(path)) return
    const st = statSync(path)
    if (st.size <= maxBytes) return

    const oldPath = join(LOG_DIR, LOG_FILE_OLD)
    if (existsSync(oldPath)) {
      try { unlinkSync(oldPath) } catch {}
    }
    try {
      renameSync(path, oldPath)
    } catch {
      // if rename fails, attempt to truncate by unlinking
      try { unlinkSync(path) } catch {}
    }
  } catch {
    // best-effort
  }
}

function writeLog(level: string, msg: string): void {
  try {
    ensureLogDir()
    rotateIfNeeded()
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`
    appendFileSync(join(LOG_DIR, LOG_FILE), line, { encoding: 'utf8' })
  } catch {
    // best-effort: do not crash on logging failures
  }
}

function isVerbose(): boolean {
  return process.env.GITSEMA_VERBOSE === '1' || process.argv.includes('--verbose')
}

export const logger = {
  info: (msg: string) => { console.log(msg); writeLog('info', msg) },
  warn: (msg: string) => { console.warn(msg); writeLog('warn', msg) },
  error: (msg: string) => { console.error(msg); writeLog('error', msg) },
  debug: (msg: string) => { if (isVerbose()) { console.debug(msg); writeLog('debug', msg) } },
}


