// Re-export shim — the canonical hybridSearch implementation lives in
// ../analysis/hybridSearch.ts. Kept as a shim to avoid duplicate-drift after
// the BM25 normalisation fix (§11.2).
export * from '../analysis/hybridSearch.js'
