import { describe, expect, test } from 'bun:test'
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

  test('full coverage enforces explicit global tile budget and reports the gap', async () => {
    const fixture = context(3712, 3712)
    const result = await runAnalysis({ ...baseInput, coverage: 'full', maxTiles: 10 }, fixture.value)
    expect(fixture.counts.encode).toBe(10)
    expect(result.detailTiles).toBe(10)
    expect(result.complete).toBe(false)
    expect(result.warnings.some(warning => warning.code === 'TILE_BUDGET_EXCEEDED')).toBe(true)
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
