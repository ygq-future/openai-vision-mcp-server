import { describe, expect, test } from 'bun:test'
import { analyzeDetailTiles } from '../../src/pipeline/analyzer.js'
import type { DetailTile } from '../../src/pipeline/analyzer.js'
import type { VisionClient } from '../../src/openai/client.js'

const tiles: DetailTile[] = Array.from({ length: 14 }, (_, tileIndex) => ({
  imageIndex: 0,
  tileIndex,
  bounds: { x: tileIndex * 10, y: 0, width: 10, height: 10 },
  encoded: { buffer: Buffer.from([tileIndex]), mediaType: 'image/webp', width: 10, height: 10, bytes: 1 },
}))

describe('analyzeDetailTiles', () => {
  test('limits concurrency and preserves batch/tile order', async () => {
    let active = 0
    let peak = 0
    let calls = 0
    const client: VisionClient = {
      async complete() {
        const batch = calls
        calls += 1
        active += 1
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, batch === 0 ? 20 : batch === 1 ? 1 : 5))
        active -= 1
        return {
          text: `batch-${String(batch)}`,
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        }
      },
    }
    const result = await analyzeDetailTiles({ tiles, userPrompt: 'inspect', client, maxConcurrency: 2 })
    expect(calls).toBe(3)
    expect(peak).toBeLessThanOrEqual(2)
    expect(result.segments).toHaveLength(14)
    expect(result.segments.map(segment => [segment.batchIndex, segment.tileIndex])).toEqual(
      tiles.map((tile, index) => [Math.floor(index / 6), tile.tileIndex]),
    )
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 6, totalTokens: 9 })
  })

  test('keeps successful batches and exposes a failed detail gap', async () => {
    let calls = 0
    const client: VisionClient = {
      complete() {
        const batch = calls
        calls += 1
        return batch === 1
          ? Promise.reject(new Error('failed'))
          : Promise.resolve({
              text: `batch-${String(batch)}`,
              finishReason: 'stop',
              usage: { promptTokens: null, completionTokens: 1, totalTokens: null },
            })
      },
    }
    const result = await analyzeDetailTiles({ tiles, userPrompt: 'inspect', client, maxConcurrency: 2 })
    expect(result.segments).toHaveLength(8)
    expect(result.complete).toBe(false)
    expect(result.warnings.some(warning => warning.code === 'DETAIL_BATCH_FAILED')).toBe(true)
    expect(result.usage.promptTokens).toBeNull()
  })
})
