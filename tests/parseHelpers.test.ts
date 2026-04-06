/**
 * Tests for the parsePositiveInt / parseNonNegativeInt CLI helpers (M7).
 */

import { describe, it, expect } from 'vitest'
import { parsePositiveInt, parseNonNegativeInt } from '../src/utils/parse.js'

describe('parsePositiveInt', () => {
  it('returns the integer for valid positive values', () => {
    expect(parsePositiveInt('1', '--top')).toBe(1)
    expect(parsePositiveInt('42', '--top')).toBe(42)
    expect(parsePositiveInt('1000', '--top')).toBe(1000)
  })

  it('throws for zero', () => {
    expect(() => parsePositiveInt('0', '--top')).toThrow('--top')
  })

  it('throws for negative numbers', () => {
    expect(() => parsePositiveInt('-1', '--top')).toThrow('--top')
  })

  it('throws for NaN strings', () => {
    expect(() => parsePositiveInt('abc', '--top')).toThrow('--top')
    expect(() => parsePositiveInt('', '--top')).toThrow('--top')
  })

  it('throws for float strings', () => {
    expect(() => parsePositiveInt('1.5', '--top')).toThrow('--top')
  })
})

describe('parseNonNegativeInt', () => {
  it('returns 0 for "0"', () => {
    expect(parseNonNegativeInt('0', '--overlap')).toBe(0)
  })

  it('returns the integer for valid positive values', () => {
    expect(parseNonNegativeInt('100', '--overlap')).toBe(100)
  })

  it('throws for negative numbers', () => {
    expect(() => parseNonNegativeInt('-1', '--overlap')).toThrow('--overlap')
  })

  it('throws for NaN strings', () => {
    expect(() => parseNonNegativeInt('xyz', '--overlap')).toThrow('--overlap')
  })
})
