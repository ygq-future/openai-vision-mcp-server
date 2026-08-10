import { delimiter, resolve } from 'node:path'
import { z } from 'zod'
import { CONFIG_LIMITS, TOOL_LIMITS } from './constants.js'
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
  VISION_DEFAULT_MAX_TILES: z.coerce
    .number()
    .int()
    .min(TOOL_LIMITS.detailTiles.min)
    .max(TOOL_LIMITS.detailTiles.max)
    .default(TOOL_LIMITS.detailTiles.default),
  VISION_MAX_INPUT_BYTES: z.coerce
    .number()
    .int()
    .min(CONFIG_LIMITS.maxInputBytes.min)
    .max(CONFIG_LIMITS.maxInputBytes.max)
    .default(CONFIG_LIMITS.maxInputBytes.default),
  VISION_MAX_DECODED_PIXELS: z.coerce
    .number()
    .int()
    .min(CONFIG_LIMITS.maxDecodedPixels.min)
    .max(CONFIG_LIMITS.maxDecodedPixels.max)
    .default(CONFIG_LIMITS.maxDecodedPixels.default),
  VISION_HTTP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(CONFIG_LIMITS.httpTimeoutMs.min)
    .max(CONFIG_LIMITS.httpTimeoutMs.max)
    .default(CONFIG_LIMITS.httpTimeoutMs.default),
  VISION_MAX_REDIRECTS: z.coerce
    .number()
    .int()
    .min(CONFIG_LIMITS.maxRedirects.min)
    .max(CONFIG_LIMITS.maxRedirects.max)
    .default(CONFIG_LIMITS.maxRedirects.default),
  VISION_MAX_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(CONFIG_LIMITS.maxConcurrency.min)
    .max(CONFIG_LIMITS.maxConcurrency.max)
    .default(CONFIG_LIMITS.maxConcurrency.default),
  VISION_ALLOWED_FILE_ROOTS: z.string().default(''),
  VISION_ALLOW_PRIVATE_NETWORK: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),
})

export function loadConfig(env: NodeJS.ProcessEnv): VisionConfig {
  const parsed = environmentSchema.safeParse(env)

  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => String(issue.path[0] ?? 'environment')))].sort()
    throw new VisionError('CONFIG_INVALID', `Invalid MCP server configuration fields: ${fields.join(', ')}.`, {
      details: { invalidFields: fields.join(', ') },
    })
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
