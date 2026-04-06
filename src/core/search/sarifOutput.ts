/**
 * SARIF 2.1.0 output for gitsema security-scan (Phase 58).
 *
 * Converts SecurityFinding[] into a valid SARIF 2.1.0 JSON report.
 *
 * Reference: https://docs.oasis-open.org/sarif/sarif/v2.1.0/
 */

import type { SecurityFinding } from './securityScan.js'

interface SarifRule {
  id: string
  name: string
  shortDescription: { text: string }
  helpUri: string
  properties: { tags: string[] }
}

interface SarifResult {
  ruleId: string
  level: 'error' | 'warning' | 'note'
  message: { text: string }
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string }
      region?: { startLine: number }
    }
  }>
  properties: {
    score: number
    confidence: string
    heuristicMatches?: string[]
  }
}

/**
 * Map a finding pattern name to a stable rule ID.
 */
function patternToRuleId(name: string): string {
  return 'GITSEMA-' + name.toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Convert SecurityFinding[] to a SARIF 2.1.0 JSON string.
 */
export function toSarif(findings: SecurityFinding[], toolVersion = '0.0.0'): string {
  // Deduplicate rules
  const rulesMap = new Map<string, SarifRule>()
  for (const f of findings) {
    const id = patternToRuleId(f.patternName)
    if (!rulesMap.has(id)) {
      rulesMap.set(id, {
        id,
        name: f.patternName.replace(/\s/g, ''),
        shortDescription: { text: `Potential ${f.patternName} vulnerability (semantic similarity score)` },
        helpUri: 'https://owasp.org/www-project-top-ten/',
        properties: { tags: ['security', 'gitsema'] },
      })
    }
  }

  const results: SarifResult[] = findings.map((f) => {
    const ruleId = patternToRuleId(f.patternName)
    const level: SarifResult['level'] = f.confidence === 'high' ? 'error' : f.confidence === 'medium' ? 'warning' : 'note'
    const path = f.paths[0] ?? f.blobHash
    const text = f.confidence === 'high'
      ? `${f.patternName} detected with high confidence (semantic score: ${f.score.toFixed(3)}, structural match confirmed).`
      : `Potential ${f.patternName} detected via semantic similarity (score: ${f.score.toFixed(3)}). Manual review required.`

    const result: SarifResult = {
      ruleId,
      level,
      message: { text },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: path.startsWith('/') ? `file://${path}` : path },
        },
      }],
      properties: {
        score: f.score,
        confidence: f.confidence,
      },
    }
    if (f.heuristicMatches && f.heuristicMatches.length > 0) {
      result.properties.heuristicMatches = f.heuristicMatches
    }
    return result
  })

  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'gitsema',
          version: toolVersion,
          informationUri: 'https://github.com/jsilvanus/gitsema',
          rules: Array.from(rulesMap.values()),
        },
      },
      results,
    }],
  }

  return JSON.stringify(sarif, null, 2)
}
