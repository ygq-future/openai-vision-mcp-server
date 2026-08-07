import sharp from 'sharp'
import type { Metadata } from 'sharp'
import { VisionError } from '../errors.js'
import type { AcquiredImage, NormalizedImage } from './types.js'

export async function normalizeImage(acquired: AcquiredImage, maxDecodedPixels: number): Promise<NormalizedImage> {
  let metadata: Metadata
  try {
    metadata = await sharp(acquired.buffer, { animated: false, limitInputPixels: false }).metadata()
  } catch (error) {
    throw new VisionError('DECODE_FAILED', 'The image metadata could not be decoded', { cause: error })
  }
  const width = metadata.width
  const height = metadata.pageHeight ?? metadata.height
  if (!width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new VisionError('DECODE_FAILED', 'The image dimensions are invalid')
  }
  const pixelCount = width * height
  if (!Number.isSafeInteger(pixelCount) || pixelCount > maxDecodedPixels) {
    throw new VisionError('PIXEL_LIMIT_EXCEEDED', 'The decoded image exceeds the pixel limit')
  }

  try {
    const { data, info } = await sharp(acquired.buffer, { animated: false, limitInputPixels: maxDecodedPixels })
      .rotate()
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 3) throw new VisionError('DECODE_FAILED', 'The image could not be normalized to RGB')
    return {
      pixels: data,
      width: info.width,
      height: info.height,
      channels: 3,
      sourceFormat: metadata.format,
      sourceName: acquired.sourceName,
      selectedFrames: 1,
    }
  } catch (error) {
    if (error instanceof VisionError) throw error
    throw new VisionError('DECODE_FAILED', 'The image pixels could not be decoded', { cause: error })
  }
}
