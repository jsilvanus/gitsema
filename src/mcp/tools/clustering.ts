import { z } from 'zod'
import { registerTool } from '../registerTool.js'
import { computeClusters, computeClusterSnapshot, compareClusterSnapshots, computeClusterTimeline, resolveRefToTimestamp, getBlobHashesUpTo } from '../../core/search/clustering.js'
import { parseDateArg } from '../../core/search/timeSearch.js'

export function registerClusteringTools(server: any) {
  registerTool(
    server,
    'clusters',
    'Cluster all indexed blobs into K semantic groups using k-means and return the cluster labels, sizes, and representative file paths.',
    {
      k: z.number().int().positive().optional().default(8).describe('Number of clusters to compute'),
      top_keywords: z.number().int().positive().optional().default(5).describe('Number of keywords per cluster label'),
      enhanced_labels: z.boolean().optional().default(false).describe('Use TF-IDF enhanced cluster labels'),
      branch: z.string().optional().describe('Restrict clustering to blobs seen on this branch'),
    },
    async ({ k, top_keywords, enhanced_labels, branch }: any) => {
      try {
        let blobHashFilter: string[] | undefined
        if (branch) {
          const { getBlobHashesOnBranch } = await import('../../core/search/clustering.js')
          blobHashFilter = getBlobHashesOnBranch(branch)
        }
        const report = await computeClusters({ k, topKeywords: top_keywords, useEnhancedLabels: enhanced_labels, blobHashFilter })
        const lines = [
          `Clusters: ${report.k}  |  Total blobs: ${report.totalBlobs}`,
          '',
        ]
        for (const c of report.clusters) {
          const kws = enhanced_labels && c.enhancedKeywords.length > 0 ? c.enhancedKeywords : c.topKeywords
          lines.push(`  [${c.id}] ${c.label}  (${c.size} blobs)  keywords: ${kws.join(', ')}`)
          lines.push(`       paths: ${c.representativePaths.slice(0, 3).join(', ')}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  registerTool(
    server,
    'cluster_diff',
    'Compare semantic clusters between two points in history.',
    {
      ref1: z.string(),
      ref2: z.string(),
      k: z.number().int().positive().optional().default(8),
    },
    async ({ ref1, ref2, k }: any) => {
      try {
        const ts1 = resolveRefToTimestamp(ref1)
        const ts2 = resolveRefToTimestamp(ref2)
        const hashes1 = getBlobHashesUpTo(ts1)
        const hashes2 = getBlobHashesUpTo(ts2)
        const snapshot1 = await computeClusterSnapshot({ k, blobHashFilter: hashes1 })
        const snapshot2 = await computeClusterSnapshot({ k, blobHashFilter: hashes2 })
        const report = compareClusterSnapshots(snapshot1, snapshot2, ref1, ref2)
        return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

  registerTool(
    server,
    'cluster_timeline',
    'Track how semantic clusters evolve through commit history.',
    {
      since: z.string().optional(),
      until: z.string().optional(),
      k: z.number().int().positive().optional().default(8),
      branch: z.string().optional(),
    },
    async ({ since, until, k, branch }: any) => {
      try {
        const opts: { k: number; since?: number; until?: number; branch?: string } = { k }
        if (since) opts.since = parseDateArg(since)
        if (until) opts.until = parseDateArg(until)
        if (branch) opts.branch = branch
        const report = await computeClusterTimeline(opts)
        return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: `Error: ${msg}` }] }
      }
    },
  )

}

