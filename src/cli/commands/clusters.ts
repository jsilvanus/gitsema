import { writeFileSync } from 'node:fs'
import { computeClusters, type ClusterReport } from '../../core/search/clustering.js'

export interface ClustersCommandOptions {
  k?: string
  top?: string
  iterations?: string
  edgeThreshold?: string
  dump?: string | boolean
  enhancedLabels?: boolean
  enhancedKeywordsN?: string
}

export async function clustersCommand(options: ClustersCommandOptions): Promise<void> {
  const k = options.k !== undefined ? parseInt(options.k, 10) : 8
  const top = options.top !== undefined ? parseInt(options.top, 10) : 5
  const iterations = options.iterations !== undefined ? parseInt(options.iterations, 10) : 20
  const edgeThreshold = options.edgeThreshold !== undefined ? parseFloat(options.edgeThreshold) : 0.3
  const useEnhancedLabels = options.enhancedLabels ?? false
  const enhancedKeywordsN = options.enhancedKeywordsN !== undefined ? parseInt(options.enhancedKeywordsN, 10) : 5

  if (isNaN(k) || k < 1) {
    console.error('Error: --k must be a positive integer')
    process.exit(1)
  }

  try {
    const report: ClusterReport = await computeClusters({
      k,
      maxIterations: iterations,
      edgeThreshold,
      topPaths: top,
      topKeywords: 5,
      useEnhancedLabels,
      enhancedKeywordsN,
    })

    if (options.dump !== undefined) {
      const json = JSON.stringify(report, null, 2)
      if (typeof options.dump === 'string') {
        writeFileSync(options.dump, json, 'utf8')
        console.log(`Wrote clusters JSON to ${options.dump}`)
      } else {
        console.log(json)
      }
      return
    }

    // human readable
    console.log(`Computed ${report.clusters.length} clusters across ${report.totalBlobs} blobs\n`)

    for (let i = 0; i < report.clusters.length; i++) {
      const c = report.clusters[i]
      const header = `Cluster ${i + 1} — ${c.label}  (${c.size} blobs)`
      console.log(header)
      console.log(`  Keywords:  ${c.topKeywords.join(', ')}`)
      if (c.enhancedKeywords.length > 0) {
        console.log(`  Enhanced:  ${c.enhancedKeywords.join(', ')}`)
      }
      console.log(`  Top paths: ${c.representativePaths.join(', ')}`)
      const neighbors = report.edges.filter((e) => e.fromId === c.id || e.toId === c.id)
        .map((e) => {
          const otherId = e.fromId === c.id ? e.toId : e.fromId
          const otherIndex = report.clusters.findIndex((cl) => cl.id === otherId)
          return `cluster ${otherIndex + 1} (${e.similarity.toFixed(2)})`
        })
      console.log(`  Neighbors: ${neighbors.join(', ')}`)
      console.log('')
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
