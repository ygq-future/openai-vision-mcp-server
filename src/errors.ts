export type VisionErrorCode =
  | 'CONFIG_INVALID'
  | 'SOURCE_UNSUPPORTED'
  | 'SOURCE_TOO_LARGE'
  | 'DECODE_FAILED'
  | 'PIXEL_LIMIT_EXCEEDED'
  | 'FILE_ACCESS_DENIED'
  | 'URL_ACCESS_DENIED'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_AUTH_FAILED'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_INVALID_RESPONSE'
  | 'INTERNAL_ERROR'

export interface VisionErrorOptions {
  retryable?: boolean
  details?: Readonly<Record<string, unknown>>
  cause?: unknown
}

export class VisionError extends Error {
  readonly code: VisionErrorCode
  readonly safeMessage: string
  readonly retryable: boolean
  readonly details: Readonly<Record<string, unknown>> | undefined

  constructor(code: VisionErrorCode, safeMessage: string, options: VisionErrorOptions = {}) {
    super(`${code}: ${safeMessage}`, { cause: options.cause })
    this.name = 'VisionError'
    this.code = code
    this.safeMessage = safeMessage
    this.retryable = options.retryable ?? false
    this.details = options.details
  }
}

export function toSafeError(error: unknown): VisionError {
  if (error instanceof VisionError) return error

  return new VisionError('INTERNAL_ERROR', 'An unexpected error occurred', {
    retryable: false,
    cause: error,
  })
}
