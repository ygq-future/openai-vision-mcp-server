import { describe, expect, test } from 'bun:test'
import { VisionError } from '../../src/errors.js'
import { createAnalyzeImagesHandler } from '../../src/tools/analyze-images/handler.js'
import type { AnalyzeImagesResult } from '../../src/tools/analyze-images/schema.js'

const result: AnalyzeImagesResult = {
  answer: 'answer',
  complete: true,
  model: 'model',
  sourceCount: 1,
  overviewCalls: 1,
  detailTiles: 0,
  apiCalls: 1,
  segments: [],
  usage: { promptTokens: null, completionTokens: null, totalTokens: null },
  warnings: [],
}

describe('analyze_images handler', () => {
  test('returns text and validated structured content', async () => {
    const handler = createAnalyzeImagesHandler({ runAnalysis: () => Promise.resolve(result) })
    const response = await handler({ prompt: 'inspect', images: [{ type: 'url', url: 'https://example.com/a.png' }] })
    expect(response).toEqual({ content: [{ type: 'text', text: 'answer' }], structuredContent: result, isError: false })
  })

  test('returns only a safe error without structured success content', async () => {
    const handler = createAnalyzeImagesHandler({
      runAnalysis: () => Promise.reject(new VisionError('UPSTREAM_AUTH_FAILED', 'Authentication failed')),
    })
    const response = await handler({ prompt: 'inspect', images: [{ type: 'url', url: 'https://example.com/a.png' }] })
    expect(response.isError).toBe(true)
    expect(response.content[0]).toMatchObject({ type: 'text', text: 'Authentication failed' })
    expect(response).not.toHaveProperty('structuredContent')
  })
})
