import { getActiveSession } from '../db/sqlite.js'
import { embedQuery } from '../embedding/embedQuery.js'
import { vectorSearch } from './vectorSearch.js'
import type { EmbeddingProvider } from '../embedding/provider.js'

export interface SecurityFinding {
  patternName: string
  blobHash: string
  paths: string[]
  score: number
  firstSeen?: number
  /** Structural signal: lines matching the heuristic regex (if applicable) */
  heuristicMatches?: string[]
  /** Combined confidence: 'high' (both semantic + structural), 'medium' (semantic only), 'structural' (heuristic only) */
  confidence: 'high' | 'medium' | 'structural'
}

const VULN_PATTERNS: Array<{
  name: string
  query: string
  /** Per-language regex heuristics for structural signal */
  heuristics?: Array<{ regex: RegExp; description: string }>
}> = [
  {
    name: 'SQL Injection',
    query: 'sql injection user input',
    heuristics: [
      { regex: /(?:execute|query|prepare)\s*\(\s*["'`].*?\+/im, description: 'string concatenation in SQL call' },
      { regex: /\$\{.*?\}.*?(?:SELECT|INSERT|UPDATE|DELETE)/im, description: 'template literal in SQL' },
      { regex: /f["'].*?(?:SELECT|INSERT|UPDATE|DELETE).*?\{/im, description: 'Python f-string in SQL' },
    ],
  },
  {
    name: 'Path Traversal',
    query: 'path traversal file access',
    heuristics: [
      { regex: /\.\.\//m, description: '../ in file path' },
      { regex: /path\.join\(.*?req\./im, description: 'path.join with request parameter' },
      { regex: /readFile\s*\(.*?req\./im, description: 'readFile with request parameter' },
    ],
  },
  {
    name: 'Cross-Site Scripting',
    query: 'xss cross site scripting html injection',
    heuristics: [
      { regex: /innerHTML\s*=\s*(?!["'`])/m, description: 'innerHTML assignment from variable' },
      { regex: /document\.write\s*\(/im, description: 'document.write usage' },
      { regex: /\$\(\s*["']html["']\s*,/im, description: 'jQuery html() with variable' },
    ],
  },
  {
    name: 'Insecure Deserialization',
    query: 'insecure deserialization object parsing',
    heuristics: [
      { regex: /pickle\.loads?\s*\(/im, description: 'Python pickle.load' },
      { regex: /yaml\.load\s*\([^,)]+\)/im, description: 'YAML.load without Loader' },
      { regex: /ObjectInputStream/im, description: 'Java ObjectInputStream' },
    ],
  },
  {
    name: 'Hardcoded Credentials',
    query: 'hardcoded password secret api key credentials',
    heuristics: [
      { regex: /(?:password|passwd|secret|api[_-]?key)\s*=\s*["'][^"']{4,}/im, description: 'hardcoded credential assignment' },
      { regex: /(?:Authorization|Bearer)\s*[:=]\s*["'][A-Za-z0-9+/=]{16,}/im, description: 'hardcoded auth token' },
      { regex: /(?:aws_access_key_id|aws_secret)\s*=\s*["'][A-Z0-9]{16,}/im, description: 'AWS credential' },
    ],
  },
  {
    name: 'SSRF',
    query: 'server side request forgery ssrf http request',
    heuristics: [
      { regex: /fetch\s*\(.*?req\./im, description: 'fetch with request parameter' },
      { regex: /requests\.get\s*\(.*?request\./im, description: 'Python requests with user input' },
      { regex: /http\.get\s*\(.*?req\./im, description: 'Node http.get with request parameter' },
    ],
  },
]

/**
 * Apply structural heuristics against stored blob content (from FTS5 table).
 * Returns matching lines as an array of strings, or undefined if no content.
 */
function applyHeuristics(
  rawDb: ReturnType<typeof getActiveSession>['rawDb'],
  blobHash: string,
  heuristics: Array<{ regex: RegExp; description: string }>,
): string[] | undefined {
  const row = rawDb.prepare(`SELECT content FROM blob_fts WHERE blob_hash = ?`).get(blobHash) as { content: string } | undefined
  if (!row?.content) return undefined
  const matches: string[] = []
  const lines = row.content.split('\n')
  for (const { regex, description } of heuristics) {
    for (const line of lines) {
      if (regex.test(line)) {
        matches.push(`[${description}] ${line.trim().slice(0, 120)}`)
        break // one match per heuristic is enough
      }
    }
  }
  return matches.length > 0 ? matches : undefined
}

export async function scanForVulnerabilities(
  dbSession: ReturnType<typeof getActiveSession>,
  provider: EmbeddingProvider,
  opts: { top?: number; model?: string } = {},
): Promise<SecurityFinding[]> {
  const top = opts.top ?? 10

  // Embed all patterns concurrently instead of sequentially — each embed is an
  // independent HTTP/gRPC call, so running them in parallel cuts latency by ~6×.
  const embedResults = await Promise.allSettled(
    VULN_PATTERNS.map(async (p) => ({
      pattern: p,
      queryEmb: await embedQuery(provider, p.query) as number[],
    })),
  )

  const findings: SecurityFinding[] = []
  for (const outcome of embedResults) {
    if (outcome.status === 'rejected') continue // skip unavailable patterns
    const { pattern: p, queryEmb } = outcome.value
    const results = vectorSearch(queryEmb, { topK: top, model: opts.model, query: p.query })
    for (const r of results) {
      // Apply structural heuristics when available
      let heuristicMatches: string[] | undefined
      if (p.heuristics && dbSession?.rawDb) {
        heuristicMatches = applyHeuristics(dbSession.rawDb, r.blobHash, p.heuristics)
      }
      const confidence: SecurityFinding['confidence'] = heuristicMatches
        ? 'high'
        : 'medium'
      findings.push({
        patternName: p.name,
        blobHash: r.blobHash,
        paths: r.paths ?? [],
        score: r.score,
        firstSeen: r.firstSeen,
        heuristicMatches,
        confidence,
      })
    }
  }
  return findings
}
