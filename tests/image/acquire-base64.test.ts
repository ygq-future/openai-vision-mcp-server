import { describe, expect, test } from 'bun:test'
import { acquireImage } from '../../src/image/acquire.js'
import { VisionError } from '../../src/errors.js'

const context = { maxInputBytes: 1024, allowedFileRoots: [], allowPrivateNetwork: false }
const pngHeader = 'iVBORw0KGgo='

describe('Base64 acquisition', () => {
  test('decodes a valid PNG data URI', async () => {
    const result = await acquireImage({ type: 'base64', data: `data:image/png;base64,${pngHeader}` }, context)
    expect(result.buffer.toString('hex')).toBe('89504e470d0a1a0a')
    expect(result.declaredMediaType).toBe('image/png')
    expect(result.sourceKind).toBe('base64')
  })

  test('accepts raw Base64 only with a matching media type', async () => {
    const result = await acquireImage({ type: 'base64', data: pngHeader, mediaType: 'image/png' }, context)
    expect(result.buffer).toHaveLength(8)
    expect(acquireImage({ type: 'base64', data: pngHeader }, context)).rejects.toBeInstanceOf(VisionError)
    expect(acquireImage({ type: 'base64', data: pngHeader, mediaType: 'image/jpeg' }, context)).rejects.toMatchObject({
      code: 'SOURCE_UNSUPPORTED',
    })
  })

  test('rejects invalid, unsupported, or oversized payloads', () => {
    expect(acquireImage({ type: 'base64', data: 'data:image/svg+xml;base64,PHN2Zz4=' }, context)).rejects.toMatchObject(
      { code: 'SOURCE_UNSUPPORTED' },
    )
    expect(
      acquireImage({ type: 'base64', data: 'not base64!', mediaType: 'image/png' }, context),
    ).rejects.toMatchObject({ code: 'SOURCE_UNSUPPORTED' })
    expect(
      acquireImage({ type: 'base64', data: pngHeader, mediaType: 'image/png' }, { ...context, maxInputBytes: 7 }),
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' })
  })
})
