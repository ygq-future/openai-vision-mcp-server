import sharp from 'sharp'
import { VisionError } from '../errors.js'
import type { EncodedImage, NormalizedImage } from './types.js'

const maxEdge = 2048
const maxPixels = 4_000_000
const maxBytes = 3 * 1024 * 1024

function initialDimensions(image: NormalizedImage): { width: number; height: number } {
  const scale = Math.min(
    1,
    maxEdge / image.width,
    maxEdge / image.height,
    Math.sqrt(maxPixels / (image.width * image.height)),
  )
  return { width: Math.max(1, Math.floor(image.width * scale)), height: Math.max(1, Math.floor(image.height * scale)) }
}

async function encode(image: NormalizedImage, width: number, height: number, quality: number): Promise<Buffer> {
  return sharp(image.pixels, { raw: { width: image.width, height: image.height, channels: image.channels } })
    .resize(width, height, { fit: 'fill', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer()
}

export async function createOverview(image: NormalizedImage): Promise<EncodedImage> {
  let { width, height } = initialDimensions(image)
  for (;;) {
    const quality90 = await encode(image, width, height, 90)
    if (quality90.length <= maxBytes) {
      return { buffer: quality90, mediaType: 'image/webp', width, height, bytes: quality90.length }
    }

    const quality70 = await encode(image, width, height, 70)
    if (quality70.length <= maxBytes) {
      let best = quality70
      let low = 71
      let high = 89
      while (low <= high) {
        const quality = Math.floor((low + high) / 2)
        const candidate = await encode(image, width, height, quality)
        if (candidate.length <= maxBytes) {
          best = candidate
          low = quality + 1
        } else {
          high = quality - 1
        }
      }
      return { buffer: best, mediaType: 'image/webp', width, height, bytes: best.length }
    }

    const nextWidth = Math.floor(width * 0.9)
    const nextHeight = Math.floor(height * 0.9)
    if (nextWidth < 256 || nextHeight < 256) {
      throw new VisionError('SOURCE_TOO_LARGE', 'The overview cannot fit within the encoded byte limit')
    }
    width = nextWidth
    height = nextHeight
  }
}
