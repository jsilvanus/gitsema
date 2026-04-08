/**
 * Backward-compatible barrel for gitsema HTML visualisations.
 *
 * Modular structure (Phase 76 modularisation):
 *   - htmlRenderer-shared.ts    — shared utilities (PALETTE, escHtml, safeJson, sanitize*, BASE_CSS, COMMON_JS)
 *   - htmlRenderer-search.ts    — search/author/firstSeen/impact/experts renderers
 *   - htmlRenderer-clusters.ts  — cluster force-graph renderers (renderClustersHtml, renderClusterDiffHtml, renderClusterTimelineHtml)
 *   - htmlRenderer-evolution.ts — evolution timeline renderers (renderConceptEvolutionHtml, renderFileEvolutionHtml)
 *   - htmlRenderer-map.ts       — analysis renderers (change-points, dead concepts, merge audit, branch summary, semantic diff)
 *
 * All external consumers continue to import from this file unchanged.
 */

// Search renderers
export { renderSearchHtml, renderAuthorHtml, renderFirstSeenHtml, renderImpactHtml, renderExpertsHtml } from './htmlRenderer-search.js'

// Cluster renderers
export { renderClustersHtml, renderClusterDiffHtml, renderClusterTimelineHtml } from './htmlRenderer-clusters.js'

// Evolution renderers
export { renderConceptEvolutionHtml, renderFileEvolutionHtml } from './htmlRenderer-evolution.js'

// Analysis / map renderers
export { renderConceptChangePointsHtml, renderFileChangePointsHtml, renderClusterChangePointsHtml, renderDeadConceptsHtml, renderMergeAuditHtml, renderBranchSummaryHtml, renderSemanticDiffHtml } from './htmlRenderer-map.js'
