/*
  Barrel exports for the search module groups — keeps a single import surface.
  Add more re-exports here as you finalize the grouping.
*/
export * from './analysis/vectorSearch.js'
export * from './analysis/hybridSearch.js'
export * from './analysis/booleanSearch.js'
export * from './analysis/resultCache.js'

export * from './core/explainFormatter.js'

export * from './clustering/clustering.js'
export * from './clustering/labelEnhancer.js'

export * from './temporal/timeSearch.js'
export * from './temporal/evolution.js'
export * from './temporal/changePoints.js'
export * from './temporal/healthTimeline.js'
