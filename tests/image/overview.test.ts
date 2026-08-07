import { describe, expect, test } from 'bun:test'
import { randomFillSync } from 'node:crypto'
import { createOverview } from '../../src/image/overview.js'
import type { NormalizedImage } from '../../src/image/types.js'

function image(width: number, height: number, noisy = false): NormalizedImage {
  const pixels = Buffer.alloc(width * height * 3, 127)
  if (noisy) randomFillSync(pixels)
  return { pixels, width, height, channels: 3, sourceFormat: 'raw', sourceName: 'fixture', selectedFrames: 1 }
}

describe('createOverview', () => {
  test('limits dimensions to 2048 and total pixels to four megapixels', async () => {
    const result = await createOverview(image(4000, 3000))
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(2048)
    expect(result.width * result.height).toBeLessThanOrEqual(4_000_000)
  })

  test('does not enlarge a small image', async () => {
    const result = await createOverview(image(500, 300))
    expect([result.width, result.height]).toEqual([500, 300])
  })

  test('keeps a noisy overview below the three MiB byte budget', async () => {
    const result = await createOverview(image(1800, 1800, true))
    expect(result.bytes).toBeLessThanOrEqual(3 * 1024 * 1024)
    expect(result.mediaType).toBe('image/webp')
    expect(result.buffer.length).toBe(result.bytes)
  })
})
