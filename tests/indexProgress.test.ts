import { describe, it, expect } from 'vitest'
import { formatElapsed } from '../src/cli/commands/index.js'

describe('formatElapsed', () => {
  it('formats sub-second durations as milliseconds', () => {
    expect(formatElapsed(0)).toBe('0ms')
    expect(formatElapsed(1)).toBe('1ms')
    expect(formatElapsed(234)).toBe('234ms')
    expect(formatElapsed(999)).toBe('999ms')
  })

  it('formats durations under a minute as seconds with one decimal', () => {
    expect(formatElapsed(1000)).toBe('1.0s')
    expect(formatElapsed(1500)).toBe('1.5s')
    expect(formatElapsed(12300)).toBe('12.3s')
    expect(formatElapsed(59000)).toBe('59.0s')
  })

  it('formats durations under an hour as Xm YYs', () => {
    expect(formatElapsed(60000)).toBe('1m 00s')
    expect(formatElapsed(61000)).toBe('1m 01s')
    expect(formatElapsed(125000)).toBe('2m 05s')
    expect(formatElapsed(3599000)).toBe('59m 59s')
  })

  it('formats durations of an hour or more as Xh YYm ZZs', () => {
    expect(formatElapsed(3600000)).toBe('1h 00m 00s')
    expect(formatElapsed(3661000)).toBe('1h 01m 01s')
    expect(formatElapsed(3662000)).toBe('1h 01m 02s')
    expect(formatElapsed(7323000)).toBe('2h 02m 03s')
    expect(formatElapsed(86400000)).toBe('24h 00m 00s')
  })
})
