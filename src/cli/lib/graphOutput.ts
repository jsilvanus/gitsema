/**
 * Shared `--out` handling for graph-traversal commands (Phase 112,
 * knowledge-graph §9): given the resolved `OutputSpec[]` and the command's
 * `RenderableSubgraph`, emits each requested sink (`html`, `json`,
 * `markdown`, `text`). Used by `graph neighbors`, `graph path`,
 * `blast-radius`, `relate`, `similar`, and `hotspots` so the unified
 * tree/force-graph rendering logic lives in one place.
 *
 * Only invoked when the user explicitly passes `--out` — each command's
 * pre-existing, bespoke text rendering (printed via plain `console.log`)
 * stays completely unchanged when no `--out` flag is given.
 */

import { writeFileSync } from 'node:fs'
import type { OutputSpec } from '../../utils/outputSink.js'
import type { RenderableSubgraph } from '../../core/graph/subgraphView.js'
import { renderGraphHtml } from '../../core/viz/htmlRenderer-graph.js'
import { renderGraphTree, renderGraphMarkdown } from './graphRender.js'

function emitOne(sink: OutputSpec, content: string, label: string): void {
  if (sink.file) {
    writeFileSync(sink.file, content, 'utf8')
    console.log(`${label} written to: ${sink.file}`)
  } else {
    process.stdout.write(content.endsWith('\n') ? content : content + '\n')
  }
}

export function emitSubgraphOutputs(sinks: OutputSpec[], sub: RenderableSubgraph, title: string): void {
  for (const sink of sinks) {
    switch (sink.format) {
      case 'html':
        emitOne(sink, renderGraphHtml(sub, { title }), 'Subgraph HTML')
        break
      case 'json':
        emitOne(sink, JSON.stringify(sub, null, 2), 'Subgraph JSON')
        break
      case 'markdown':
        emitOne(sink, renderGraphMarkdown(sub), 'Subgraph markdown')
        break
      case 'text':
      default:
        emitOne(sink, renderGraphTree(sub), 'Subgraph')
        break
    }
  }
}
