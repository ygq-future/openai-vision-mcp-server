import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { VisionError } from '../errors.js'
import { assertAllowedFileUri } from '../security/file-policy.js'
import { assertSafeRemoteUrl } from '../security/url-policy.js'
import type { ImageSource } from '../tools/analyze-images/schema.js'
import type { AcquiredImage, AcquisitionContext, SupportedImageMediaType } from './types.js'

const supportedMediaTypes = new Set<SupportedImageMediaType>(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const base64Pattern = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/

function detectMediaType(buffer: Buffer): SupportedImageMediaType | undefined {
  if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'image/gif'
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return undefined
}

function decodeBase64(data: string, declaredMediaType: string | undefined, maxInputBytes: number): AcquiredImage {
  const dataUri = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(data)
  const mediaType = dataUri?.[1] ?? declaredMediaType
  const encoded = (dataUri?.[2] ?? data).replace(/[\t\n\r ]/g, '')
  if (!mediaType || !supportedMediaTypes.has(mediaType as SupportedImageMediaType) || !base64Pattern.test(encoded)) {
    throw new VisionError('SOURCE_UNSUPPORTED', 'The Base64 image payload is invalid or unsupported')
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const decodedSize = (encoded.length / 4) * 3 - padding
  if (decodedSize > maxInputBytes) throw new VisionError('SOURCE_TOO_LARGE', 'The image exceeds the byte limit')

  const buffer = Buffer.from(encoded, 'base64')
  const detected = detectMediaType(buffer)
  if (detected !== mediaType)
    throw new VisionError('SOURCE_UNSUPPORTED', 'The image media type does not match its data')
  return { buffer, declaredMediaType: detected, sourceKind: 'base64', sourceName: 'base64-image' }
}

export async function fetchImage(input: string | URL, context: AcquisitionContext): Promise<AcquiredImage> {
  let url = await assertSafeRemoteUrl(input, context)
  const maxRedirects = context.maxRedirects ?? 3
  const timeoutMs = context.httpTimeoutMs ?? 15_000

  for (let redirects = 0; ; redirects += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, timeoutMs)
    let response: Response
    try {
      response = await fetch(url, { redirect: 'manual', signal: controller.signal })
    } catch (error) {
      clearTimeout(timeout)
      if (controller.signal.aborted) {
        throw new VisionError('UPSTREAM_TIMEOUT', 'The remote image request timed out', {
          retryable: true,
          cause: error,
        })
      }
      throw new VisionError('UPSTREAM_ERROR', 'The remote image request failed', { retryable: true, cause: error })
    }

    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timeout)
      await response.body?.cancel()
      if (redirects >= maxRedirects)
        throw new VisionError('URL_ACCESS_DENIED', 'The remote image redirected too many times')
      const location = response.headers.get('location')
      if (!location) throw new VisionError('URL_ACCESS_DENIED', 'The remote image redirect is invalid')
      url = await assertSafeRemoteUrl(new URL(location, url), context)
      continue
    }
    if (!response.ok) {
      clearTimeout(timeout)
      throw new VisionError('UPSTREAM_ERROR', 'The remote image request returned an error')
    }

    const headerMediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (!headerMediaType || !supportedMediaTypes.has(headerMediaType as SupportedImageMediaType)) {
      clearTimeout(timeout)
      throw new VisionError('SOURCE_UNSUPPORTED', 'The remote resource is not a supported image')
    }
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > context.maxInputBytes) {
      clearTimeout(timeout)
      throw new VisionError('SOURCE_TOO_LARGE', 'The image exceeds the byte limit')
    }
    if (!response.body) {
      clearTimeout(timeout)
      throw new VisionError('SOURCE_UNSUPPORTED', 'The remote image response is empty')
    }

    const chunks: Uint8Array[] = []
    let byteLength = 0
    try {
      for await (const chunk of response.body) {
        byteLength += chunk.byteLength
        if (byteLength > context.maxInputBytes) {
          controller.abort()
          throw new VisionError('SOURCE_TOO_LARGE', 'The image exceeds the byte limit')
        }
        chunks.push(chunk)
      }
    } catch (error) {
      if (error instanceof VisionError) throw error
      if (controller.signal.aborted) {
        throw new VisionError('UPSTREAM_TIMEOUT', 'The remote image request timed out', {
          retryable: true,
          cause: error,
        })
      }
      throw new VisionError('UPSTREAM_ERROR', 'The remote image response could not be read', {
        retryable: true,
        cause: error,
      })
    } finally {
      clearTimeout(timeout)
    }
    const buffer = Buffer.concat(chunks, byteLength)
    const detected = detectMediaType(buffer)
    if (!detected || detected !== headerMediaType) {
      throw new VisionError('SOURCE_UNSUPPORTED', 'The remote image media type does not match its data')
    }
    return {
      buffer,
      declaredMediaType: detected,
      sourceKind: 'url',
      sourceName: basename(url.pathname) || url.hostname,
    }
  }
}

export async function acquireImage(source: ImageSource, context: AcquisitionContext): Promise<AcquiredImage> {
  if (source.type === 'base64') {
    const result = decodeBase64(source.data, source.mediaType, context.maxInputBytes)
    return source.label ? { ...result, sourceName: source.label } : result
  }
  if (source.type === 'url') {
    const result = await fetchImage(source.url, context)
    return source.label ? { ...result, sourceName: source.label } : result
  }

  const path = await assertAllowedFileUri(source.uri, context.allowedFileRoots)
  if ((await stat(path)).size > context.maxInputBytes) {
    throw new VisionError('SOURCE_TOO_LARGE', 'The image exceeds the byte limit')
  }
  const buffer = await readFile(path)
  if (buffer.length > context.maxInputBytes)
    throw new VisionError('SOURCE_TOO_LARGE', 'The image exceeds the byte limit')
  const detected = detectMediaType(buffer)
  if (!detected) throw new VisionError('SOURCE_UNSUPPORTED', 'The local image format is unsupported')
  return { buffer, declaredMediaType: detected, sourceKind: 'file', sourceName: source.label ?? basename(path) }
}
