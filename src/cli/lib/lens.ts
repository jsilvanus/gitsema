import type { Command } from 'commander'

/**
 * The cross-cutting `--lens` toggle (Phase 109, knowledge-graph §7): which of
 * the semantic/structural signals drive a command's ranking.
 *
 * - `semantic`   — vectors + FTS only (today's default; structural weight 0).
 * - `structural` — pure graph traversal/ranking (vector weight 0).
 * - `hybrid`     — both blended.
 */
export type Lens = 'semantic' | 'structural' | 'hybrid'

export function parseLens(value: string | undefined, fallback: Lens): Lens {
  if (value === 'semantic' || value === 'structural' || value === 'hybrid') return value
  return fallback
}

/** Ranking-weight overrides for `vectorSearch`'s four-signal formula (§7.2). */
export interface LensWeights {
  weightVector?: number
  weightRecency?: number
  weightPath?: number
  weightStructural?: number
}

/**
 * Translates `--lens` (+ optional `--weight-structural` override) into
 * `vectorSearch` ranking-weight overrides.
 *
 * `semantic` with no explicit structural weight returns `{}` — leaving
 * `vectorSearch`'s defaults untouched, so existing semantic-lens callers stay
 * byte-for-byte identical to pre-Phase-109 behavior.
 */
export function lensWeights(lens: Lens, weightStructural?: number): LensWeights {
  switch (lens) {
    case 'structural':
      return { weightVector: 0, weightRecency: 0, weightPath: 0, weightStructural: weightStructural ?? 1 }
    case 'hybrid':
      return { weightStructural: weightStructural ?? 0.3 }
    case 'semantic':
    default:
      return weightStructural !== undefined ? { weightStructural } : {}
  }
}

/** Adds the shared `--lens` and `--weight-structural` options to a command. */
export function addLensOption(cmd: Command, defaultLens: Lens): Command {
  return cmd
    .option('--lens <lens>', `'semantic' | 'structural' | 'hybrid' — which signal(s) drive ranking (default: ${defaultLens})`, defaultLens)
    .option('--weight-structural <n>', 'structural signal weight (overrides the --lens default)')
}
