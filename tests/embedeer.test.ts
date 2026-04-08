import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock the @jsilvanus/embedeer package before importing our helper
const mockLoadModel = vi.fn(async (modelName: string) => ({ modelName }))
const mockApplyPerf = vi.fn(async (arg: any) => {})

// Provide both named exports and a `default` export because the code does
// `const mod = await import('@jsilvanus/embedeer')` and then uses
// `mod.default ?? mod`.
vi.mock('@jsilvanus/embedeer', () => {
  const obj = {
    loadModel: mockLoadModel,
    Embedder: {
      applyPerfProfile: mockApplyPerf,
      loadModel: mockLoadModel,
    },
  }
  return { default: obj, ...obj }
})

import { ensureModelDownloadedAndOptimized } from '../src/core/embedding/embedeer.js'

describe('ensureModelDownloadedAndOptimized', () => {
  beforeEach(() => {
    mockLoadModel.mockClear()
    mockApplyPerf.mockClear()
  })

  it('calls loadModel when model is missing and download is requested', async () => {
    await ensureModelDownloadedAndOptimized('test-model', { downloadIfMissing: true, optimize: false })
    expect(mockLoadModel).toHaveBeenCalledWith('test-model')
  })

  it('calls applyPerfProfile when optimisation is requested and available', async () => {
    await ensureModelDownloadedAndOptimized('test-model-2', { downloadIfMissing: true, optimize: true })
    // loadModel should be invoked
    expect(mockLoadModel).toHaveBeenCalledWith('test-model-2')
    // applyPerfProfile on the Embedder should be attempted (best-effort)
    expect(mockApplyPerf).toHaveBeenCalled()
  })
})
