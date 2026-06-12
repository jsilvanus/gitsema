/**
 * Shared JSON-sink output epilogue for CLI commands.
 *
 * Most commands resolve `--out`/`--dump`/`--html` sinks via `resolveOutputs()`,
 * then — if a `json` sink is present — serialize a payload, write it to the sink
 * (file or stdout), and short-circuit further (human-readable) output unless a
 * `text` (or `html`) sink was *also* requested.
 *
 * `emitJsonSink` reproduces that exact control flow so call sites can replace
 * their inline copy with a single call.
 */

import { writeFileSync } from 'node:fs'
import { type OutputSpec, hasSinkFormat } from '../../utils/outputSink.js'

export interface EmitJsonSinkOptions {
  /** All resolved output sinks for this command. */
  sinks: OutputSpec[]
  /** The `json` sink, as returned by `getSink(sinks, 'json')`. */
  jsonSink: OutputSpec | undefined
  /** Payload to serialize with `JSON.stringify(payload, null, 2)`. */
  payload: unknown
  /**
   * Builds the confirmation message printed via `console.log` when the JSON
   * sink writes to a file. Receives the destination file path.
   */
  fileMessage: (file: string) => string
  /**
   * When true, also check for an `html` sink before deciding whether to
   * short-circuit (matches call sites that render HTML after the JSON block).
   * Default: false.
   */
  htmlAware?: boolean
}

/**
 * Result of `emitJsonSink`. `handled` is `true` when the JSON sink consumed
 * output and the caller should `return` immediately (stdout JSON case).
 * `continueRendering` is `true` when the caller should proceed to render
 * human-readable (or HTML) output afterwards.
 */
export interface EmitJsonSinkResult {
  /** Caller should return immediately without further output. */
  handled: boolean
  /** Caller should continue to subsequent (text/html) rendering. */
  continueRendering: boolean
}

/**
 * Reproduces the standard JSON-sink epilogue:
 *
 *   if (jsonSink) {
 *     const json = JSON.stringify(payload, null, 2)
 *     if (jsonSink.file) {
 *       writeFileSync(jsonSink.file, json, 'utf8')
 *       console.log(fileMessage(jsonSink.file))
 *     } else {
 *       process.stdout.write(json + '\n')
 *       return
 *     }
 *     if (!hasSinkFormat(sinks, 'text') [&& !hasSinkFormat(sinks, 'html')]) return
 *   }
 *
 * Returns `{ handled: true, ... }` when the caller should `return`
 * immediately. Otherwise `continueRendering` indicates whether to proceed to
 * the next (e.g. HTML or text) rendering step.
 */
export function emitJsonSink(opts: EmitJsonSinkOptions): EmitJsonSinkResult {
  const { sinks, jsonSink, payload, fileMessage, htmlAware = false } = opts

  if (!jsonSink) {
    return { handled: false, continueRendering: true }
  }

  const json = JSON.stringify(payload, null, 2)

  if (jsonSink.file) {
    writeFileSync(jsonSink.file, json, 'utf8')
    console.log(fileMessage(jsonSink.file))
  } else {
    process.stdout.write(json + '\n')
    return { handled: true, continueRendering: false }
  }

  const shouldStop = htmlAware
    ? !hasSinkFormat(sinks, 'text') && !hasSinkFormat(sinks, 'html')
    : !hasSinkFormat(sinks, 'text')

  if (shouldStop) {
    return { handled: true, continueRendering: false }
  }

  return { handled: false, continueRendering: true }
}
