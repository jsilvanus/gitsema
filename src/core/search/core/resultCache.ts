// Re-export shim — the canonical result cache lives in ../analysis/resultCache.ts.
// Having two independent copies led to split cache state (core/ cache never
// being invalidated on index updates) so they are unified here.
export * from '../analysis/resultCache.js'
