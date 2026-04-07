/**
 * Shared utilities for all htmlRenderer submodules.
 *
 * Exports:
 *   - PALETTE — chart/node colour palette
 *   - escHtml — HTML-safe string escaping (TypeScript)
 *   - safeJson — JSON safe for embedding in <script> blocks
 *   - sanitizeCluster / sanitizeClusterReport / sanitizeTemporalReport / sanitizeTimelineReport — strip heavy centroid arrays
 *   - BASE_CSS — shared dark-theme CSS string
 *   - COMMON_JS — shared browser JS utilities (esc, shortHash)
 */

import type { ClusterReport, TemporalClusterReport, ClusterTimelineReport } from '../search/clustering.js'

// ─── Shared constants ─────────────────────────────────────────────────────────

export const PALETTE = [
  '#7aa2f7', '#9ece6a', '#e0af68', '#f7768e', '#bb9af7',
  '#7dcfff', '#ff9e64', '#73daca', '#c0caf5', '#db4b4b',
  '#2ac3de', '#41a6b5', '#b4f9f8', '#ff75a0', '#a9b1d6', '#6ebb9e',
]

export function escHtml(s: unknown): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Serializes data as JSON safe for embedding inside a <script> block.
 * Replaces `<`, `>`, `&`, and the Unicode line/paragraph separators with their
 * unicode escapes so the browser HTML parser cannot see `</script>` or `<!--`
 * in the source, preventing script injection.
 * The JSON value is still valid and will be parsed correctly by the JS engine.
 */
export function safeJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

// ─── Data sanitizers (strip heavy centroid arrays) ────────────────────────────

export function sanitizeCluster(c: { id: number; label: string; size: number; representativePaths: string[]; topKeywords: string[]; enhancedKeywords: string[] }) {
  return {
    id: c.id,
    label: c.label,
    size: c.size,
    representativePaths: c.representativePaths ?? [],
    topKeywords: c.topKeywords ?? [],
    enhancedKeywords: c.enhancedKeywords ?? [],
  }
}

export function sanitizeClusterReport(r: ClusterReport) {
  return {
    k: r.k,
    clusteredAt: r.clusteredAt,
    totalBlobs: r.totalBlobs,
    clusters: r.clusters.map(sanitizeCluster),
    edges: (r.edges ?? []).map((e) => ({ fromId: e.fromId, toId: e.toId, similarity: e.similarity })),
  }
}

export function sanitizeTemporalReport(r: TemporalClusterReport) {
  const sanitizeChange = (ch: typeof r.changes[number]) => ({
    afterCluster: ch.afterCluster ? sanitizeCluster(ch.afterCluster) : null,
    beforeCluster: ch.beforeCluster ? sanitizeCluster(ch.beforeCluster) : null,
    centroidDrift: ch.centroidDrift,
    stable: ch.stable,
    newBlobs: ch.newBlobs,
    removedBlobs: ch.removedBlobs,
    inflows: ch.inflows ?? [],
    outflows: ch.outflows ?? [],
  })
  return {
    ref1: r.ref1,
    ref2: r.ref2,
    newBlobsTotal: r.newBlobsTotal,
    removedBlobsTotal: r.removedBlobsTotal,
    movedBlobsTotal: r.movedBlobsTotal,
    stableBlobsTotal: r.stableBlobsTotal,
    before: sanitizeClusterReport(r.before),
    after: sanitizeClusterReport(r.after),
    changes: (r.changes ?? []).map(sanitizeChange),
  }
}

export function sanitizeTimelineReport(r: ClusterTimelineReport) {
  return {
    k: r.k,
    since: r.since,
    until: r.until,
    steps: (r.steps ?? []).map((s) => ({
      ref: s.ref,
      timestamp: s.timestamp,
      blobCount: s.blobCount,
      clusters: (s.clusters ?? []).map(sanitizeCluster),
      stats: s.stats ?? null,
      prevRef: s.prevRef ?? null,
      changes: (s.changes ?? []).map((ch) => ({
        afterCluster: ch.afterCluster ? sanitizeCluster(ch.afterCluster) : null,
        beforeCluster: ch.beforeCluster ? sanitizeCluster(ch.beforeCluster) : null,
        centroidDrift: ch.centroidDrift,
        inflows: ch.inflows ?? [],
        outflows: ch.outflows ?? [],
      })),
    })),
  }
}

// ─── Shared CSS ───────────────────────────────────────────────────────────────

export const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1b26;color:#c0caf5;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.5}
.hdr{padding:10px 16px;background:#24283b;border-bottom:1px solid #2f3451;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.hdr h1{font-size:16px;font-weight:600;color:#7aa2f7}
.stat{background:#2f3451;padding:2px 9px;border-radius:10px;font-size:12px;color:#a9b1d6}
.stat b{color:#7aa2f7}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:#1a1b26}
::-webkit-scrollbar-thumb{background:#2f3451;border-radius:3px}
`

// ─── Shared JS helper (no ${} in this block) ─────────────────────────────────

export const COMMON_JS = `
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function shortHash(h) { return String(h).slice(0, 7); }
`
