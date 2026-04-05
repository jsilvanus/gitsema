import { describe, it, expect } from 'vitest'
import {
  quantizeVector,
  dequantizeVector,
  serializeQuantized,
  deserializeQuantized,
} from '../src/core/embedding/quantize.js'

describe('quantizeVector', () => {
  it('produces Int8Array of same length as input', () => {
    const vec = [0.1, 0.5, -0.3, 0.9, -0.9]
    const q = quantizeVector(vec)
    expect(q.data.length).toBe(vec.length)
  })

  it('all output values are in [-128, 127]', () => {
    const vec = [0.1, 0.5, -0.3, 0.9, -0.9]
    const q = quantizeVector(vec)
    for (const v of q.data) {
      expect(v).toBeGreaterThanOrEqual(-128)
      expect(v).toBeLessThanOrEqual(127)
    }
  })

  it('handles all-same-value vector without division by zero', () => {
    const vec = [0.5, 0.5, 0.5]
    expect(() => quantizeVector(vec)).not.toThrow()
    const q = quantizeVector(vec)
    expect(q.scale).toBeGreaterThan(0)
  })

  it('handles all-zero vector', () => {
    const vec = [0, 0, 0]
    expect(() => quantizeVector(vec)).not.toThrow()
  })
})

describe('round-trip precision', () => {
  it('recovers approximate float32 values after quantize+dequantize', () => {
    const vec = [0.1, 0.5, -0.3, 0.9, -0.9, 0.0, 1.0, -1.0]
    const q = quantizeVector(vec)
    const recovered = dequantizeVector(q)
    for (let i = 0; i < vec.length; i++) {
      // Int8 quantization introduces up to ~scale/2 error per component
      expect(Math.abs(recovered[i] - vec[i])).toBeLessThan(q.scale + 1e-9)
    }
  })

  it('cosine similarity is preserved to within 2% for typical embedding', () => {
    // A pseudo-random 768-dim vector
    const dim = 768
    const vec = Array.from({ length: dim }, (_, i) => Math.sin(i * 0.1) * 0.5)
    const q = quantizeVector(vec)
    const recovered = dequantizeVector(q)

    // Compute cosine similarity between original and recovered
    let dot = 0; let magA = 0; let magB = 0
    for (let i = 0; i < dim; i++) {
      dot += vec[i] * recovered[i]
      magA += vec[i] ** 2
      magB += recovered[i] ** 2
    }
    const cos = dot / (Math.sqrt(magA) * Math.sqrt(magB))
    expect(cos).toBeGreaterThan(0.98)  // < 2% degradation
  })
})

describe('serialize/deserialize', () => {
  it('serializes to a Buffer and deserializes back correctly', () => {
    const vec = [0.1, 0.5, -0.3, 0.9, -0.9]
    const q = quantizeVector(vec)
    const buf = serializeQuantized(q)
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBe(q.data.length)

    const q2 = deserializeQuantized(buf, q.min, q.scale)
    expect(q2.min).toBe(q.min)
    expect(q2.scale).toBe(q.scale)
    expect(q2.data.length).toBe(q.data.length)
    for (let i = 0; i < q.data.length; i++) {
      expect(q2.data[i]).toBe(q.data[i])
    }
  })

  it('round-trips through serialize/deserialize and produces same float recovery', () => {
    const vec = [0.2, -0.4, 0.6, 0.8, -0.1]
    const q = quantizeVector(vec)
    const buf = serializeQuantized(q)
    const q2 = deserializeQuantized(buf, q.min, q.scale)
    const r1 = dequantizeVector(q)
    const r2 = dequantizeVector(q2)
    for (let i = 0; i < r1.length; i++) {
      expect(r2[i]).toBeCloseTo(r1[i], 10)
    }
  })
})
