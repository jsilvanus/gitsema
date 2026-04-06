import { vectorSearch } from './vectorSearch.js'

export interface SecurityFinding {
  patternName: string
  blobHash: string
  paths: string[]
  score: number
  firstSeen?: number
}

const VULN_PATTERNS: Array<{ name: string; query: string }> = [
  { name: 'SQL Injection', query: "sql injection" },
  { name: 'Path Traversal', query: "path traversal" },
  { name: 'Cross-Site Scripting', query: "xss" },
  { name: 'Insecure Deserialization', query: "insecure deserialization" },
  { name: 'Hardcoded Credentials', query: "hardcoded password" },
  { name: 'SSRF', query: "ssrf" },
]

export async function scanForVulnerabilities(dbSession: any, provider: any, opts: { top?: number; model?: string } = {}) : Promise<SecurityFinding[]> {
  const top = opts.top ?? 10
  const findings: SecurityFinding[] = []
  for (const p of VULN_PATTERNS) {
    // embed query using provider if available — fallback to simple vector placeholder
    let queryEmb: number[] = [1, 0, 0]
    try {
      const { embedQuery } = await import('../embedding/embedQuery.js')
      queryEmb = await embedQuery(provider, p.query) as any
    } catch (_e) {
      // ignore
    }
    const results = vectorSearch(queryEmb, { topK: top, model: opts.model, query: p.query })
    for (const r of results) {
      findings.push({ patternName: p.name, blobHash: r.blobHash, paths: r.paths ?? [], score: r.score, firstSeen: r.firstSeen })
    }
  }
  return findings
}
