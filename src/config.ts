import { delimiter, resolve } from 'node:path'
import { z } from 'zod'
import { VisionError } from './errors.js'

export interface VisionConfig {
  baseUrl: string
  apiKey: string
  model: string
  defaultMaxTiles: number
  maxInputBytes: number
  maxDecodedPixels: number
  httpTimeoutMs: number
  maxRedirects: number
  maxConcurrency: number
  allowedFileRoots: string[]
  allowPrivateNetwork: boolean
}

const requiredText = z.string().trim().min(1)

const environmentSchema = z.object({
  VISION_BASE_URL: requiredText
    .pipe(z.url())
    .refine(value => URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol)),
  VISION_API_KEY: requiredText,
  VISION_MODEL: requiredText,
  VISION_DEFAULT_MAX_TILES: z.coerce.number().int().min(1).max(64).default(24),
  VISION_MAX_INPUT_BYTES: z.coerce.number().int().min(1_024).max(104_857_600).default(20_971_520),
  VISION_MAX_DECODED_PIXELS: z.coerce.number().int().min(1_000_000).max(400_000_000).default(40_000_000),
  VISION_HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(15_000),
  VISION_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(3),
  VISION_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  VISION_ALLOWED_FILE_ROOTS: z.string().default(''),
  VISION_ALLOW_PRIVATE_NETWORK: z
    .enum(['true', 'false'])
    .default('false')
    .transform(value => value === 'true'),
})

export function loadConfig(env: NodeJS.ProcessEnv): VisionConfig {
  const parsed = environmentSchema.safeParse(env)

  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => String(issue.path[0] ?? 'environment')))].sort()
    throw new VisionError('CONFIG_INVALID', `Invalid configuration fields: ${fields.join(', ')}`)
  }

  const values = parsed.data
  const roots = values.VISION_ALLOWED_FILE_ROOTS.split(delimiter)
    .map(root => root.trim())
    .filter(root => root.length > 0)
    .map(root => resolve(root))

  return {
    baseUrl: values.VISION_BASE_URL.replace(/\/+$/, ''),
    apiKey: values.VISION_API_KEY,
    model: values.VISION_MODEL,
    defaultMaxTiles: values.VISION_DEFAULT_MAX_TILES,
    maxInputBytes: values.VISION_MAX_INPUT_BYTES,
    maxDecodedPixels: values.VISION_MAX_DECODED_PIXELS,
    httpTimeoutMs: values.VISION_HTTP_TIMEOUT_MS,
    maxRedirects: values.VISION_MAX_REDIRECTS,
    maxConcurrency: values.VISION_MAX_CONCURRENCY,
    allowedFileRoots: [...new Set(roots)],
    allowPrivateNetwork: values.VISION_ALLOW_PRIVATE_NETWORK,
  }
}
