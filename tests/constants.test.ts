import { describe, expect, test } from 'bun:test'
import {
  ANALYSIS_POLICY,
  CONFIG_LIMITS,
  IMAGE_POLICY,
  SERVER_INFO,
  TOOL_LIMITS,
  UPSTREAM_POLICY,
} from '../src/constants.js'
import { loadConfig } from '../src/config.js'
import { analyzeImagesInputSchema } from '../src/tools/analyze-images/schema.js'

const requiredEnvironment = {
  VISION_BASE_URL: 'https://vision.example/v1',
  VISION_API_KEY: 'secret',
  VISION_MODEL: 'vision-model',
}

describe('central policy constants', () => {
  test('keep server and public tool policies synchronized', () => {
    expect(SERVER_INFO).toEqual({ name: 'openai-vision-mcp-server', version: '0.1.12' })
    expect(TOOL_LIMITS.detailTiles).toEqual({ min: 1, max: 64, default: 24 })

    const parsed = analyzeImagesInputSchema.parse({
      prompt: 'inspect',
      images: [{ type: 'url', url: 'https://example.com/image.png' }],
    })
    expect(parsed.coverage).toBe('auto')
    expect(parsed.maxTiles).toBeUndefined()
  })

  test('keep configuration defaults and bounds explicit', () => {
    expect(CONFIG_LIMITS.maxInputBytes).toEqual({ min: 1_024, max: 104_857_600, default: 20_971_520 })
    expect(CONFIG_LIMITS.maxDecodedPixels).toEqual({ min: 1_000_000, max: 400_000_000, default: 100_000_000 })
    expect(CONFIG_LIMITS.httpTimeoutMs).toEqual({ min: 100, max: 300_000, default: 30_000 })
    expect(CONFIG_LIMITS.maxRedirects).toEqual({ min: 0, max: 10, default: 3 })
    expect(CONFIG_LIMITS.maxConcurrency).toEqual({ min: 1, max: 16, default: 1 })

    const config = loadConfig(requiredEnvironment)
    expect(config).toMatchObject({
      defaultMaxTiles: TOOL_LIMITS.detailTiles.default,
      maxInputBytes: CONFIG_LIMITS.maxInputBytes.default,
      maxDecodedPixels: CONFIG_LIMITS.maxDecodedPixels.default,
      httpTimeoutMs: CONFIG_LIMITS.httpTimeoutMs.default,
      maxRedirects: CONFIG_LIMITS.maxRedirects.default,
      maxConcurrency: CONFIG_LIMITS.maxConcurrency.default,
    })
  })

  test('name image, retry, and batching policies', () => {
    expect(IMAGE_POLICY.grid).toEqual({ tileSize: 1_024, overlap: 128, preferredRegionMargin: 0.15 })
    expect(IMAGE_POLICY.overview.maxBytes).toBe(3 * 1_024 * 1_024)
    expect(IMAGE_POLICY.detailTile.maxBytes).toBe(1.5 * 1_024 * 1_024)
    expect(UPSTREAM_POLICY.maxAttempts).toBe(3)
    expect(ANALYSIS_POLICY.detailTilesPerBatch).toBe(6)
  })
})
