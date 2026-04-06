import { writeFileSync } from 'node:fs'
import { computeClusters, getBlobHashesOnBranch, type ClusterReport } from '../../core/search/clustering.js'
import { renderClustersHtml } from '../../core/viz/htmlRenderer.js'
import { applyModelOverrides } from '../../core/embedding/providerFactory.js'
import { narrateClusters } from '../../core/llm/narrator.js'

export interface ClustersCommandOptions {
  k?: string
  top?: string
  iterations?: string
  edgeThreshold?: string
  dump?: string | boolean
  html?: string | boolean
  enhancedLabels?: boolean
  enhancedKeywordsN?: string
  branch?: string
  narrate?: boolean
  // CLI model overrides
  model?: string
  textModel?: string
  codeModel?: string
  noHeadings?: boolean
}

export async function clustersCommand(options: ClustersCommandOptions): Promise<void> {
  // Apply CLI model overrides
  applyModelOverrides({ model: options.model, textModel: options.textModel, codeModel: options.codeModel })

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
    const blobHashFilter = options.branch ? getBlobHashesOnBranch(options.branch) : undefined
    const report: ClusterReport = await computeClusters({
      k,
      maxIterations: iterations,
      edgeThreshold,
      topPaths: top,
      topKeywords: 5,
      useEnhancedLabels,
      enhancedKeywordsN,
      blobHashFilter,
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

    if (options.html !== undefined) {
      const html = renderClustersHtml(report)
      const outFile = typeof options.html === 'string' ? options.html : 'clusters.html'
      try {
        writeFileSync(outFile, html, 'utf8')
        console.log(`Wrote clusters HTML to ${outFile}`)
      } catch (err) {
        console.error(`Error writing HTML file: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
      return
    }

    // human readable
    if (!options.noHeadings) {
      console.log(`Computed ${report.clusters.length} clusters across ${report.totalBlobs} blobs\n`)
    }

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

    // Phase 56: LLM narration
    if (options.narrate) {
      console.log('')
      console.log('=== LLM Cluster Narrative ===')
      const narrative = await narrateClusters(report)
      console.log(narrative)
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
