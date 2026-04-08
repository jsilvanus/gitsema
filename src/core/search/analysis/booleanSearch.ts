import type { SearchResult } from '../../models/types.js'

export function mergeOr(a: SearchResult[], b: SearchResult[], topK: number): SearchResult[] {
  const map = new Map<string, SearchResult>()
  for (const r of a) map.set(r.blobHash, r)
  for (const r of b) {
    const existing = map.get(r.blobHash)
    if (!existing || r.score > existing.score) map.set(r.blobHash, r)
  }
  const results = [...map.values()]
  results.sort((x, y) => y.score - x.score)
  return results.slice(0, topK)
}

export function mergeAnd(a: SearchResult[], b: SearchResult[], topK: number): SearchResult[] {
  const mapB = new Map(b.map((r) => [r.blobHash, r]))
  const results: SearchResult[] = []
  for (const ra of a) {
    const rb = mapB.get(ra.blobHash)
    if (rb) {
      const harmonic = 2 * ra.score * rb.score / (ra.score + rb.score + 1e-9)
      results.push({ ...ra, score: harmonic })
    }
  }
  results.sort((x, y) => y.score - x.score)
  return results.slice(0, topK)
}

export function parseBooleanQuery(input: string): { op: 'AND' | 'OR'; parts: string[] } | null {
  const andMatch = input.match(/^(.+?)\s+AND\s+(.+)$/i)
  if (andMatch) return { op: 'AND', parts: [andMatch[1].trim(), andMatch[2].trim()] }
  const orMatch = input.match(/^(.+?)\s+OR\s+(.+)$/i)
  if (orMatch) return { op: 'OR', parts: [orMatch[1].trim(), orMatch[2].trim()] }
  return null
}
