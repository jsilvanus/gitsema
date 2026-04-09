// Re-export shim — the canonical vectorSearch implementation lives in
// ../analysis/vectorSearch.ts. Keeping two independent copies caused the
// cache-key fix (§11.1) to require two identical edits and created drift risk.
export * from '../analysis/vectorSearch.js'
