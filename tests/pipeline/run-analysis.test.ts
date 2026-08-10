import { describe, expect, test } from 'bun:test'
import { VisionError } from '../../src/errors.js'
import { runAnalysis } from '../../src/pipeline/run-analysis.js'
import type { AnalysisContext } from '../../src/pipeline/run-analysis.js'
import type { VisionClient } from '../../src/openai/client.js'

const baseSource = { type: 'base64' as const, data: 'AA==', mediaType: 'image/png' as const }
const baseInput = {
  prompt: 'inspect',
  images: [baseSource],
}

function context(
  width: number,
  height: number,
  defaultMaxTiles = 24,
): { value: AnalysisContext; counts: Record<string, number> } {
  const counts = { acquire: 0, normalize: 0, overview: 0, encode: 0, calls: 0 }
  const client: VisionClient = {
    complete(request) {
      counts.calls += 1
      if (request.prompt.startsWith('Analyze overview')) {
        return Promise.resolve({
          text: JSON.stringify({
            overview: 'overview answer',
            overviewSufficient: true,
            contentKinds: ['diagram'],
            regions: [],
            uncertainties: [],
          }),
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        })
      }
      return Promise.resolve({
        text: request.images.length === 0 ? 'aggregated' : 'detail',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      })
    },
  }
  const value: AnalysisContext = {
    config: {
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
      model: 'model',
      defaultMaxTiles,
      maxInputBytes: 1000,
      maxDecodedPixels: 40_000_000,
      httpTimeoutMs: 1000,
      maxRedirects: 1,
      maxConcurrency: 2,
      allowedFileRoots: [],
      allowPrivateNetwork: false,
    },
    client,
    acquire: source => {
      counts.acquire += 1
      return Promise.resolve({
        buffer: Buffer.from('x'),
        declaredMediaType: 'image/png',
        sourceKind: source.type,
        sourceName: 'fake',
      })
    },
    normalize: acquired => {
      counts.normalize += 1
      return Promise.resolve({
        pixels: Buffer.alloc(1),
        width,
        height,
        channels: 3,
        sourceFormat: 'raw',
        sourceName: acquired.sourceName,
        selectedFrames: 1,
      })
    },
    createOverview: () => {
      counts.overview += 1
      return Promise.resolve({ buffer: Buffer.from('o'), mediaType: 'image/webp', width: 1, height: 1, bytes: 1 })
    },
    encodeTile: (_image, bounds) => {
      counts.encode += 1
      return Promise.resolve({
        buffer: Buffer.from('t'),
        mediaType: 'image/webp',
        width: bounds.width,
        height: bounds.height,
        bytes: 1,
      })
    },
  }
  return { value, counts }
}

describe('runAnalysis', () => {
  test('processes each source once and performs overview-only analysis', async () => {
    const fixture = context(500, 300)
    const result = await runAnalysis(
      { ...baseInput, images: [baseSource, baseSource], coverage: 'overview' },
      fixture.value,
    )
    expect(fixture.counts).toMatchObject({ acquire: 2, normalize: 2, overview: 2, encode: 0, calls: 2 })
    expect(result).toMatchObject({ sourceCount: 2, overviewCalls: 2, detailTiles: 0, apiCalls: 2, complete: true })
  })

  test('auto skips detail when overview is sufficient', async () => {
    const fixture = context(3712, 3712)
    const result = await runAnalysis({ ...baseInput, coverage: 'auto' }, fixture.value)
    expect(result.detailTiles).toBe(0)
    expect(fixture.counts.encode).toBe(0)
  })

  test('continues with usable images and preserves the failed image disposition', async () => {
    const fixture = context(500, 300)
    const acquire = fixture.value.acquire
    if (!acquire) throw new TypeError('Expected the acquisition fixture')
    fixture.value.acquire = (source, acquisitionContext) =>
      source.type === 'base64' && source.data === 'bad'
        ? Promise.reject(
            new VisionError('UPSTREAM_TIMEOUT', 'The remote image request timed out.', {
              details: { stage: 'image_fetch' },
            }),
          )
        : acquire(source, acquisitionContext)

    const result = await runAnalysis(
      {
        ...baseInput,
        images: [{ ...baseSource, data: 'bad' }, baseSource],
        coverage: 'overview',
      },
      fixture.value,
    )

    expect(result.sourceCount).toBe(1)
    expect(result.complete).toBe(false)
    expect(result.warnings).toContainEqual({
      code: 'IMAGE_FAILED',
      message: 'Image 0 was skipped: The remote image request timed out.',
      retryable: true,
      userActionRequired: true,
      nextAction:
        'Continue with the other images and disclose this omission. Retry this image once only if it is required.',
      details: { stage: 'image_fetch', underlyingCode: 'UPSTREAM_TIMEOUT', imageIndex: 0 },
      imageIndex: 0,
    })
  })

  test('full coverage enforces explicit global tile budget and reports the gap', async () => {
    const fixture = context(3712, 3712)
    const result = await runAnalysis({ ...baseInput, coverage: 'full', maxTiles: 10 }, fixture.value)
    expect(fixture.counts.encode).toBe(10)
    expect(result.detailTiles).toBe(10)
    expect(result.complete).toBe(false)
    expect(result.warnings).toContainEqual({
      code: 'TILE_BUDGET_EXCEEDED',
      message: 'Detail coverage requires 16 tiles, but this call allows 10.',
      retryable: false,
      userActionRequired: true,
      nextAction:
        'Continue with the partial result, disclose the missing coverage, and increase maxTiles only if the user requests complete analysis.',
      details: { requiredTiles: 16, allowedTiles: 10 },
    })
  })

  test('malformed auto planning falls back to the configured default budget', async () => {
    const fixture = context(3712, 3712, 5)
    fixture.value.client = {
      complete: request =>
        Promise.resolve({
          text: request.prompt.startsWith('Analyze overview')
            ? 'malformed'
            : request.images.length === 0
              ? 'aggregated'
              : 'detail',
          finishReason: 'stop',
          usage: { promptTokens: null, completionTokens: null, totalTokens: null },
        }),
    }
    const result = await runAnalysis({ ...baseInput, coverage: 'auto' }, fixture.value)
    expect(result.detailTiles).toBe(5)
    expect(result.complete).toBe(false)
  })
})
