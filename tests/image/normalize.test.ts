import { describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import { normalizeImage } from '../../src/image/normalize.js'
import type { AcquiredImage } from '../../src/image/types.js'

const acquired = (buffer: Buffer, name = 'fixture'): AcquiredImage => ({
  buffer,
  declaredMediaType: 'image/png',
  sourceKind: 'base64',
  sourceName: name,
})

describe('normalizeImage', () => {
  test('applies EXIF rotation and emits three-channel sRGB raw pixels', async () => {
    const buffer = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#ff0000' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const result = await normalizeImage(acquired(buffer), 1_000)
    expect([result.width, result.height]).toEqual([3, 2])
    expect(result.channels).toBe(3)
    expect(result.pixels).toHaveLength(18)
  })

  test('selects only one frame from animated input', async () => {
    const first = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'black' } })
      .png()
      .toBuffer()
    const second = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
      .png()
      .toBuffer()
    const buffer = await sharp([first, second], { join: { animated: true } })
      .gif({ loop: 0, delay: [10, 10] })
      .toBuffer()
    const result = await normalizeImage(acquired(buffer), 1_000)
    expect(result.selectedFrames).toBe(1)
    expect([result.width, result.height]).toEqual([2, 2])
  })

  test('rejects oversized metadata before raw allocation', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"/>')
    expect(normalizeImage(acquired(svg), 40_000_000)).rejects.toMatchObject({ code: 'PIXEL_LIMIT_EXCEEDED' })
  })
})
