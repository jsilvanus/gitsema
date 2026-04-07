/**
 * Unified output-sink system for gitsema CLI commands.
 *
 * Commands accept `--out <spec>` (repeatable) where spec is:
 *
 *   text               → human-readable text to stdout  (default when nothing given)
 *   json               → JSON to stdout
 *   json:path/file     → JSON written to path/file
 *   html               → HTML to stdout
 *   html:path/file     → HTML written to path/file
 *   markdown           → Markdown to stdout
 *   markdown:path/file → Markdown written to path/file
 *   sarif:path/file    → SARIF written to path/file
 *
 * Multiple `--out` flags are supported to produce several outputs in one run:
 *   gitsema search "auth" --out text --out json:results.json --out html:results.html
 *
 * Backward compatibility: --dump / --html / --format are translated to OutputSpec[]
 * via resolveOutputs() so existing code keeps working unchanged.
 */

import { writeFileSync } from 'node:fs'

export type OutputFormat = 'text' | 'json' | 'html' | 'markdown' | 'sarif'

export interface OutputSpec {
  format: OutputFormat
  /** undefined = stdout */
  file?: string
}

/**
 * Commander.js collector function. Use as:
 *   .option('--out <spec>', 'output spec (repeatable)', collectOut, [])
 */
export function collectOut(val: string, prev: string[]): string[] {
  return [...prev, val]
}

/**
 * Parse a single --out spec string into an OutputSpec.
 * Throws a descriptive error on invalid format.
 */
export function parseOutputSpec(spec: string): OutputSpec {
  const colonIdx = spec.indexOf(':')
  if (colonIdx === -1) {
    const fmt = spec.trim().toLowerCase() as OutputFormat
    if (!isValidFormat(fmt)) throw new Error(`Unknown output format "${spec}". Valid formats: text, json, html, markdown, sarif`)
    return { format: fmt }
  }
  const fmt = spec.slice(0, colonIdx).trim().toLowerCase() as OutputFormat
  const file = spec.slice(colonIdx + 1).trim()
  if (!isValidFormat(fmt)) throw new Error(`Unknown output format "${fmt}". Valid formats: text, json, html, markdown, sarif`)
  if (!file) throw new Error(`Missing file path in --out "${spec}"`)
  return { format: fmt, file }
}

function isValidFormat(fmt: string): fmt is OutputFormat {
  return ['text', 'json', 'html', 'markdown', 'sarif'].includes(fmt)
}

/**
 * Resolve the effective list of OutputSpecs for a command, handling:
 *  - new --out specs array (primary)
 *  - legacy --dump flag (backward compat → json sink)
 *  - legacy --html flag (backward compat → html sink)
 *  - legacy --format flag (backward compat → that format on stdout)
 *
 * When nothing is specified, returns a single `{ format: 'text' }` (stdout).
 */
export function resolveOutputs(opts: {
  out?: string[]
  dump?: string | boolean
  html?: string | boolean
  format?: string
}): OutputSpec[] {
  // New --out takes priority
  if (opts.out && opts.out.length > 0) {
    return opts.out.map(parseOutputSpec)
  }

  const sinks: OutputSpec[] = []

  // Legacy --dump
  if (opts.dump !== undefined) {
    sinks.push({
      format: 'json',
      file: typeof opts.dump === 'string' && opts.dump !== '' ? opts.dump : undefined,
    })
  }

  // Legacy --html
  if (opts.html !== undefined) {
    sinks.push({
      format: 'html',
      file: typeof opts.html === 'string' && opts.html !== '' ? opts.html : undefined,
    })
  }

  // Legacy --format
  if (opts.format && opts.format !== 'text') {
    sinks.push({ format: opts.format.toLowerCase() as OutputFormat })
  }

  if (sinks.length > 0) return sinks
  return [{ format: 'text' }]
}

/**
 * Write content to a sink. If the sink has a file, write to disk and print a
 * confirmation line. If no file (stdout sink), write directly to stdout.
 */
export function writeToSink(sink: OutputSpec, content: string, label = 'Output'): void {
  if (sink.file) {
    writeFileSync(sink.file, content, 'utf8')
    console.log(`${label} written to: ${sink.file}`)
  } else {
    process.stdout.write(content)
    if (!content.endsWith('\n')) process.stdout.write('\n')
  }
}

/**
 * Check whether any of the resolved sinks has a specific format.
 */
export function hasSinkFormat(sinks: OutputSpec[], format: OutputFormat): boolean {
  return sinks.some((s) => s.format === format)
}

/**
 * Return the first sink matching a format (or undefined).
 */
export function getSink(sinks: OutputSpec[], format: OutputFormat): OutputSpec | undefined {
  return sinks.find((s) => s.format === format)
}
