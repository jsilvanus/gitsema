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

const START = '<!-- GENERATED:INTERPRETATIONS START -->'
const END = '<!-- GENERATED:INTERPRETATIONS END -->'

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
    '(run `pnpm gen:skill` to regenerate). For each capability: what the result ' +
    'shape is, and how to read it — what is significant, thresholds, and caveats.',
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
  return replaceBlock(content, block)
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
