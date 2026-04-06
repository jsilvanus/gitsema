/**
 * Shared CLI option parsing helpers.
 */

/**
 * Parse a string as a positive integer.
 * Throws with a descriptive message if the value is not a valid positive integer.
 * Use in CLI action handlers to replace bare `parseInt(s, 10)` calls that would
 * silently produce NaN and be passed to SQL LIMIT / OFFSET clauses.
 */
export function parsePositiveInt(value: string, optionName: string): number {
  const n = parseInt(value, 10)
  if (isNaN(n) || n < 1 || String(n) !== value.trim()) {
    throw new Error(`${optionName} must be a positive integer, got: ${JSON.stringify(value)}`)
  }
  return n
}

/**
 * Parse a string as a non-negative integer.
 * Throws with a descriptive message if the value is not a valid non-negative integer.
 */
export function parseNonNegativeInt(value: string, optionName: string): number {
  const n = parseInt(value, 10)
  if (isNaN(n) || n < 0 || String(n) !== value.trim()) {
    throw new Error(`${optionName} must be a non-negative integer, got: ${JSON.stringify(value)}`)
  }
  return n
}
