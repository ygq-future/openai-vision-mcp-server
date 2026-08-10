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

  test('returns matching text and structured guidance for a domain error', async () => {
    const handler = createAnalyzeImagesHandler({
      runAnalysis: () =>
        Promise.reject(
          new VisionError('UPSTREAM_AUTH_FAILED', 'The vision API rejected the configured credentials.', {
            details: { stage: 'vision_api', httpStatus: 401 },
            cause: new Error('Bearer secret-token'),
          }),
        ),
    })
    const response = await handler({ prompt: 'inspect', images: [{ type: 'url', url: 'https://example.com/a.png' }] })
    expect(response.isError).toBe(true)
    expect(response.content[0]).toMatchObject({
      type: 'text',
      text: [
        'Error code: UPSTREAM_AUTH_FAILED',
        'Message: The vision API rejected the configured credentials.',
        'Retryable: no',
        'User action required: yes',
        'Next action: Do not retry. Ask the user to verify VISION_API_KEY, VISION_BASE_URL, and VISION_MODEL.',
      ].join('\n'),
    })
    expect(response.structuredContent).toEqual({
      error: {
        code: 'UPSTREAM_AUTH_FAILED',
        message: 'The vision API rejected the configured credentials.',
        retryable: false,
        userActionRequired: true,
        nextAction: 'Do not retry. Ask the user to verify VISION_API_KEY, VISION_BASE_URL, and VISION_MODEL.',
        details: { stage: 'vision_api', httpStatus: 401 },
      },
    })
    expect(JSON.stringify(response)).not.toContain('secret-token')
  })

  test('maps direct invalid arguments to a caller-correctable INPUT_INVALID error', async () => {
    const handler = createAnalyzeImagesHandler({ runAnalysis: () => Promise.resolve(result) })

    const response = await handler({ prompt: '', images: [] })

    expect(response.isError).toBe(true)
    expect(response.structuredContent).toEqual({
      error: {
        code: 'INPUT_INVALID',
        message: 'The analyze_images arguments are invalid: images, prompt.',
        retryable: false,
        userActionRequired: false,
        nextAction: 'Do not retry unchanged. Correct the arguments using the analyze_images Tool input schema.',
        details: { invalidFields: 'images, prompt' },
      },
    })
  })
})
