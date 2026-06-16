/**
 * Regenerates the "Interpreting gitsema tool results" block in
 * skill/gitsema-ai-assistant.md (and syncs .github/skills/gitsema.md) from
 * src/core/narrator/interpretations.ts — the single source of truth for how
 * to read each gitsema capability's output.
 *
 * Run via `pnpm gen:skill`. The `docsSync` test fails if the committed skill
 * is out of date with this generator's output.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  TOOL_INTERPRETATIONS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
} from '../src/core/narrator/interpretations.js'
import { GUIDE_TOOLS } from '../src/core/narrator/guideTools.js'

const START = '<!-- GENERATED:INTERPRETATIONS START -->'
const END = '<!-- GENERATED:INTERPRETATIONS END -->'

/**
 * Usage guidance per tool (description + parameters) lives with the executable
 * `GUIDE_TOOLS` definitions; result-interpretation guidance lives in
 * `interpretations.ts`. The skill block joins the two by tool name so every
 * entry shows BOTH "how to use" and "how to read it". Indexed by the canonical
 * tool name and its MCP aliases so interpretation entries resolve their usage.
 */
const USAGE_BY_NAME = (() => {
  const map = new Map()
  for (const entry of Object.values(GUIDE_TOOLS)) {
    map.set(entry.definition.name, entry.definition)
  }
  return map
})()

/** Render an object-schema's parameters as a compact, readable list. */
function renderParameters(parameters) {
  const props = parameters?.properties ?? {}
  const names = Object.keys(props)
  if (names.length === 0) return undefined
  const required = new Set(parameters?.required ?? [])
  return names
    .map((name) => {
      const desc = (props[name]?.description ?? '').replace(/\s+/g, ' ').trim()
      const req = required.has(name) ? ' (required)' : ''
      return `\`${name}\`${req}${desc ? ` — ${desc}` : ''}`
    })
    .join('; ')
}

export function buildInterpretationsBlock() {
  const byCategory = new Map()
  for (const entry of Object.values(TOOL_INTERPRETATIONS)) {
    const list = byCategory.get(entry.category) ?? []
    list.push(entry)
    byCategory.set(entry.category, list)
  }

  const lines = []
  lines.push(START)
  lines.push('')
  lines.push(
    'This section is generated from `src/core/narrator/interpretations.ts` ' +
    '(result interpretation) joined with the `GUIDE_TOOLS` definitions in ' +
    '`src/core/narrator/guideTools.ts` (usage) — run `pnpm gen:skill` to ' +
    'regenerate. For each capability: how to use it (what it does + parameters), ' +
    'what the result shape is, and how to read it — what is significant, ' +
    'thresholds, and caveats.',
  )
  lines.push('')

  for (const cat of CATEGORY_ORDER) {
    const entries = byCategory.get(cat)
    if (!entries || entries.length === 0) continue
    lines.push(`### ${CATEGORY_LABELS[cat]}`)
    lines.push('')
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`**\`${e.name}\`** — ${e.summary}`)
      lines.push('')
      const usage = USAGE_BY_NAME.get(e.name) ?? (e.aliases ?? []).map((a) => USAGE_BY_NAME.get(a)).find(Boolean)
      if (usage) {
        lines.push(`- Usage: ${usage.description.replace(/\s+/g, ' ').trim()}`)
        const params = renderParameters(usage.parameters)
        if (params) lines.push(`- Parameters: ${params}`)
      }
      lines.push(`- Result shape: ${e.resultShape}`)
      lines.push(`- How to read it: ${e.interpretation}`)
      if (e.aliases?.length) {
        lines.push(`- Also known as: ${e.aliases.map((a) => `\`${a}\``).join(', ')}`)
      }
      lines.push('')
    }
  }

  lines.push(END)
  return lines.join('\n')
}

function replaceBlock(content, block) {
  const startIdx = content.indexOf(START)
  const endIdx = content.indexOf(END)
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Could not find ${START} / ${END} markers`)
  }
  return content.slice(0, startIdx) + block + content.slice(endIdx + END.length)
}

export function applyToFile(target, block) {
  const content = readFileSync(target, 'utf8')
  const usesCrlf = content.includes('\r\n')
  const normalizedBlock = usesCrlf ? block.replace(/\r?\n/g, '\r\n') : block.replace(/\r\n/g, '\n')
  return replaceBlock(content, normalizedBlock)
}

function main() {
  const root = path.resolve(import.meta.dirname, '..')
  const block = buildInterpretationsBlock()

  const targets = [
    path.join(root, 'skill', 'gitsema-ai-assistant.md'),
    path.join(root, '.github', 'skills', 'gitsema.md'),
  ]

  for (const target of targets) {
    const updated = applyToFile(target, block)
    writeFileSync(target, updated, 'utf8')
    console.log(`Updated ${path.relative(root, target)}`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, 'gen-skill.mjs')
if (isMain) main()
