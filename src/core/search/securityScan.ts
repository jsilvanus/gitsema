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
      findings.push({ patternName: p.name, blobHash: r.blobHash, paths: r.paths ?? [], score: r.score, firstSeen: r.firstSeen })
    }
  }
  return findings
}
