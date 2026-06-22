/**
 * Shared result-size cap for tool/result JSON sent to an LLM (review9 §6.4).
 *
 * `guideTools.ts`'s `toCappedJson()` and `llm/narrator.ts`'s
 * `narrateToolResult()` each truncate a JSON-serialized result before it
 * reaches a prompt; both used an independent `4000`-char constant. One
 * shared value keeps the cap consistent if it's ever tuned.
 */

export const RESULT_CHAR_CAP = 4000

/** Truncates `json` to `RESULT_CHAR_CAP` characters, appending a marker if cut. */
export function capJson(json: string): string {
  if (json.length <= RESULT_CHAR_CAP) return json
  return `${json.slice(0, RESULT_CHAR_CAP)}…truncated`
}
