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
}

const VULN_PATTERNS: Array<{ name: string; query: string }> = [
  { name: 'SQL Injection', query: 'sql injection user input' },
  { name: 'Path Traversal', query: 'path traversal file access' },
  { name: 'Cross-Site Scripting', query: 'xss cross site scripting html injection' },
  { name: 'Insecure Deserialization', query: 'insecure deserialization object parsing' },
  { name: 'Hardcoded Credentials', query: 'hardcoded password secret api key credentials' },
  { name: 'SSRF', query: 'server side request forgery ssrf http request' },
]

export async function scanForVulnerabilities(
  _dbSession: ReturnType<typeof getActiveSession>,
  provider: EmbeddingProvider,
  opts: { top?: number; model?: string } = {},
): Promise<SecurityFinding[]> {
  const top = opts.top ?? 10
  const findings: SecurityFinding[] = []
  for (const p of VULN_PATTERNS) {
    let queryEmb: number[]
    try {
      queryEmb = await embedQuery(provider, p.query) as number[]
    } catch (_e) {
      // Skip this pattern if we can't embed the query — e.g. provider not running
      continue
    }
    const results = vectorSearch(queryEmb, { topK: top, model: opts.model, query: p.query })
    for (const r of results) {
      findings.push({ patternName: p.name, blobHash: r.blobHash, paths: r.paths ?? [], score: r.score, firstSeen: r.firstSeen })
    }
  }
  return findings
}
