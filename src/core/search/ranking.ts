import type { SearchResult } from '../models/types.js'

export function shortHash(h?: string | null): string {
	const s = String(h ?? '')
	return s.length <= 7 ? s : s.slice(0, 7)
}

export function formatScore(n: number): string {
	return n.toFixed(3)
}

export function formatDate(timestamp: number | null | undefined): string {
	if (timestamp === null || timestamp === undefined) return 'unknown'
	return new Date(timestamp * 1000).toISOString().slice(0, 10)
}

export type GroupMode = 'file' | 'module' | 'commit'

export function groupResults(results: SearchResult[], mode: GroupMode, topK: number): SearchResult[] {
	if (!results || results.length === 0) return []
	const map = new Map<string, SearchResult>()
	for (const r of results) {
		let key = r.blobHash
		if (mode === 'file') {
			key = (r.paths && r.paths[0]) ?? r.blobHash
		} else if (mode === 'module') {
			const p = (r.paths && r.paths[0]) ?? ''
			const idx = p.lastIndexOf('/')
			key = idx > 0 ? p.slice(0, idx) : p || r.blobHash
		} else if (mode === 'commit') {
			key = r.firstCommit ?? r.blobHash
		}
		const existing = map.get(key)
		if (!existing || (typeof r.score === 'number' && r.score > (existing.score as number))) {
			map.set(key, r)
		}
	}
	const out = Array.from(map.values()).sort((a, b) => (b.score as number) - (a.score as number))
	return out.slice(0, topK)
}

export function renderResults(results: SearchResult[], showHeadings = true): string {
	if (!results || results.length === 0) return '  (no results)'
	const lines: string[] = []
	for (const r of results) {
		const score = typeof r.score === 'number' ? formatScore(r.score) : String(r.score)
		const path = (r.paths && r.paths[0]) ?? '(unknown path)'
		const hash = shortHash(r.blobHash)
		let line = `${score}  ${path}  [${hash}]`
		if (r.firstSeen !== undefined && r.firstSeen !== null) {
			line += `  ${formatDate(r.firstSeen)}`
		}
		if (r.startLine !== undefined && r.endLine !== undefined) {
			line += ` :${r.startLine}-${r.endLine}`
		}
		lines.push(line)
	}
	return lines.join('\n')
}

export function renderFirstSeenResults(results: SearchResult[], showHeadings = true): string {
	return renderResults(results, showHeadings)
}


