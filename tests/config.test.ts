import { describe, expect, test } from 'bun:test'
import { delimiter, isAbsolute, resolve } from 'node:path'
import { loadConfig } from '../src/config.js'
import { VisionError, toSafeError } from '../src/errors.js'

const required = {
  VISION_BASE_URL: 'https://api.example.com/v1/',
  VISION_API_KEY: 'secret',
  VISION_MODEL: 'vision-model',
}

describe('loadConfig', () => {
  test('loads required values and defaults', () => {
    const config = loadConfig(required)

    expect(config.baseUrl).toBe('https://api.example.com/v1')
    expect(config.model).toBe('vision-model')
    expect(config.defaultMaxTiles).toBe(24)
    expect(config.maxInputBytes).toBe(20_971_520)
    expect(config.maxDecodedPixels).toBe(40_000_000)
    expect(config.httpTimeoutMs).toBe(15_000)
    expect(config.maxRedirects).toBe(3)
    expect(config.maxConcurrency).toBe(2)
    expect(config.allowedFileRoots).toEqual([resolve(process.cwd())])
    expect(config.allowPrivateNetwork).toBe(false)
  })

  test('parses bounded overrides, booleans, and file roots', () => {
    const config = loadConfig({
      ...required,
      VISION_DEFAULT_MAX_TILES: '64',
      VISION_MAX_INPUT_BYTES: '1024',
      VISION_MAX_DECODED_PIXELS: '1000000',
      VISION_HTTP_TIMEOUT_MS: '2500',
      VISION_MAX_REDIRECTS: '0',
      VISION_MAX_CONCURRENCY: '4',
      VISION_ALLOWED_FILE_ROOTS: ['relative-root', resolve('absolute-root')].join(delimiter),
      VISION_ALLOW_PRIVATE_NETWORK: 'true',
    })

    expect(config.defaultMaxTiles).toBe(64)
    expect(config.allowPrivateNetwork).toBe(true)
    expect(config.allowedFileRoots).toContain(resolve(process.cwd()))
    expect(config.allowedFileRoots).toHaveLength(3)
    expect(config.allowedFileRoots.every(isAbsolute)).toBe(true)
  })

  test.each([
    ['VISION_DEFAULT_MAX_TILES', '0'],
    ['VISION_ALLOW_PRIVATE_NETWORK', 'yes'],
    ['VISION_BASE_URL', 'not-a-url'],
    ['VISION_API_KEY', ''],
  ])('rejects invalid %s without exposing configuration values', (name, value) => {
    const invalidValue = value.length === 0 ? value : `sensitive-${value}`

    try {
      loadConfig({ ...required, [name]: name === 'VISION_ALLOW_PRIVATE_NETWORK' ? value : invalidValue })
      throw new Error('expected loadConfig to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(VisionError)
      expect((error as VisionError).code).toBe('CONFIG_INVALID')
      expect(String(error)).toContain(name)
      if (invalidValue.length > 0) expect(String(error)).not.toContain(invalidValue)
      expect(String(error)).not.toContain('secret')
    }
  })
})

describe('safe errors', () => {
  test('preserves domain errors and converts unknown failures', () => {
    const domain = new VisionError('SOURCE_TOO_LARGE', 'The image is too large', { retryable: false })

    expect(toSafeError(domain)).toBe(domain)
    expect(toSafeError(new Error('Bearer secret'))).toMatchObject({
      code: 'INTERNAL_ERROR',
      safeMessage: 'An unexpected error occurred',
      retryable: false,
    })
  })
})
