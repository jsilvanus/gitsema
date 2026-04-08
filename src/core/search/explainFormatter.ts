/**
 * Provenance-oriented explain output for LLM retrieval contexts (Phase 64).
 *
 * When `--explain` is used in a retrieval pipeline, consumers often want
 * machine-readable data about *why* each result was returned.  This module
 * provides a formatter that emits structured, citation-friendly text designed
 * for injection into LLM prompts as retrieval evidence.
 *
 * Format per result (Markdown citation block):
 *
 * ```
 * ## [1] src/foo/bar.ts  (score=0.847)
 * - Blob: a1b2c3d
 * - First seen: 2024-03-15
 * - Signals: cosine=0.921  recency=0.712  pathScore=0.450
 * - Snippet: (first 200 chars of stored content, if available)
 * ```
 *
 * This structured format lets LLMs understand the retrieval evidence,
 * attribute quotes to specific files/commits, and reason about result quality.
 */

export * from './core/explainFormatter.js'
