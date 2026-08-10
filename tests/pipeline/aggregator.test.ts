import { describe, expect, test } from 'bun:test'
import type { EncodedImage } from '../../src/image/types.js'
import { aggregateAnalysis } from '../../src/pipeline/aggregator.js'
import type { VisionClient } from '../../src/openai/client.js'
import type { AnalysisSegment, AnalysisWarning } from '../../src/tools/analyze-images/schema.js'

const segments: AnalysisSegment[] = [
  { imageIndex: 0, tileIndex: 1, batchIndex: 1, bounds: { x: 10, y: 0, width: 10, height: 10 }, text: 'second' },
  { imageIndex: 0, tileIndex: 0, batchIndex: 0, bounds: { x: 0, y: 0, width: 10, height: 10 }, text: 'first' },
]
const warnings: AnalysisWarning[] = [{ code: 'TILE_BUDGET_EXCEEDED', message: 'missing region' }]
const overviewImage: EncodedImage = {
  buffer: Buffer.from('overview'),
  mediaType: 'image/webp',
  width: 2,
  height: 2,
  bytes: 8,
}

describe('aggregateAnalysis', () => {
  test('uses overview references with stable observations and warnings', async () => {
    let prompt = ''
    let capturedImages: readonly EncodedImage[] = []
    const client: VisionClient = {
      complete(request) {
        prompt = request.prompt
        capturedImages = request.images
        return Promise.resolve({
          text: 'merged answer',
          finishReason: 'stop',
          usage: { promptTokens: 4, completionTokens: 5, totalTokens: 9 },
        })
      },
    }
    const result = await aggregateAnalysis({
      userPrompt: 'answer',
      overviewText: 'overview',
      overviewImages: [overviewImage],
      segments,
      warnings,
      complete: false,
      usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
      client,
    })
    expect(capturedImages).toEqual([overviewImage])
    expect(prompt.indexOf('first')).toBeLessThan(prompt.indexOf('second'))
    expect(prompt).toContain('missing region')
    expect(prompt).toContain('remove overlap duplicates')
    expect(result.answer).toBe('merged answer')
    expect(result.complete).toBe(false)
    expect(result.usage).toEqual({ promptTokens: 6, completionTokens: 8, totalTokens: 14 })
  })

  test('falls back to labeled ordered text when aggregation fails', async () => {
    const client: VisionClient = { complete: () => Promise.reject(new Error('failed')) }
    const result = await aggregateAnalysis({
      userPrompt: 'answer',
      overviewText: 'overview',
      segments,
      warnings: [],
      complete: true,
      usage: { promptTokens: null, completionTokens: 3, totalTokens: null },
      client,
    })
    expect(result.answer.indexOf('first')).toBeLessThan(result.answer.indexOf('second'))
    expect(result.warnings.some(warning => warning.code === 'AGGREGATION_FAILED')).toBe(true)
    expect(result.complete).toBe(false)
    expect(result.usage.promptTokens).toBeNull()
  })
})
