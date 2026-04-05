/**
 * Int8 scalar quantization of embedding vectors.
 */

export interface QuantizedVector {
  data: Int8Array
  min: number
  scale: number
}

/**
 * Quantizes a Float32 embedding to Int8 using per-vector min/max scaling.
 */
export function quantizeVector(vector: number[]): QuantizedVector {
  const min = Math.min(...vector)
  const max = Math.max(...vector)
  const range = max - min || 1
  const scale = range / 255
  const data = new Int8Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    data[i] = Math.round((vector[i] - min) / scale) - 128
  }
  return { data, min, scale }
}

/**
 * Dequantizes an Int8 vector back to approximate float32.
 */
export function dequantizeVector(q: QuantizedVector): number[] {
  const result = new Array<number>(q.data.length)
  for (let i = 0; i < q.data.length; i++) {
    result[i] = (q.data[i] + 128) * q.scale + q.min
  }
  return result
}

/**
 * Serializes a QuantizedVector to a Buffer for SQLite storage.
 */
export function serializeQuantized(q: QuantizedVector): Buffer {
  return Buffer.from(q.data.buffer)
}

/**
 * Deserializes a Buffer from SQLite back to a QuantizedVector.
 */
export function deserializeQuantized(buf: Buffer, min: number, scale: number): QuantizedVector {
  const data = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  return { data, min, scale }
}
