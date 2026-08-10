import sharp from 'sharp'
import { IMAGE_POLICY } from '../constants.js'
import { VisionError } from '../errors.js'
import type { EncodedImage, NormalizedImage } from './types.js'

function initialDimensions(image: NormalizedImage): { width: number; height: number } {
  const scale = Math.min(
    1,
    IMAGE_POLICY.overview.maxEdge / image.width,
    IMAGE_POLICY.overview.maxEdge / image.height,
    Math.sqrt(IMAGE_POLICY.overview.maxPixels / (image.width * image.height)),
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
    const quality90 = await encode(image, width, height, IMAGE_POLICY.overview.highestQuality)
    if (quality90.length <= IMAGE_POLICY.overview.maxBytes) {
      return { buffer: quality90, mediaType: 'image/webp', width, height, bytes: quality90.length }
    }

    const quality70 = await encode(image, width, height, IMAGE_POLICY.overview.lowestQuality)
    if (quality70.length <= IMAGE_POLICY.overview.maxBytes) {
      let best = quality70
      let low: number = IMAGE_POLICY.overview.qualitySearchMin
      let high: number = IMAGE_POLICY.overview.qualitySearchMax
      while (low <= high) {
        const quality = Math.floor((low + high) / 2)
        const candidate = await encode(image, width, height, quality)
        if (candidate.length <= IMAGE_POLICY.overview.maxBytes) {
          best = candidate
          low = quality + 1
        } else {
          high = quality - 1
        }
      }
      return { buffer: best, mediaType: 'image/webp', width, height, bytes: best.length }
    }

    const nextWidth = Math.floor(width * IMAGE_POLICY.overview.scaleDownFactor)
    const nextHeight = Math.floor(height * IMAGE_POLICY.overview.scaleDownFactor)
    if (nextWidth < IMAGE_POLICY.overview.minEdge || nextHeight < IMAGE_POLICY.overview.minEdge) {
      throw new VisionError('SOURCE_TOO_LARGE', 'The overview cannot fit within the encoded byte limit.', {
        details: { stage: 'overview_encode', maxBytes: IMAGE_POLICY.overview.maxBytes },
      })
    }
    width = nextWidth
    height = nextHeight
  }
}
