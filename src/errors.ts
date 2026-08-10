export type VisionErrorCode =
  | 'INPUT_INVALID'
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

export type SafeIssueDetail = string | number | boolean
export type SafeIssueDetails = Readonly<Record<string, SafeIssueDetail>>

export interface ActionableIssue {
  code: VisionErrorCode
  message: string
  retryable: boolean
  userActionRequired: boolean
  nextAction: string
  details?: SafeIssueDetails
}

export interface VisionErrorOptions {
  retryable?: boolean
  userActionRequired?: boolean
  nextAction?: string
  details?: SafeIssueDetails
  cause?: unknown
}

type ErrorDisposition = Pick<ActionableIssue, 'retryable' | 'userActionRequired' | 'nextAction'>

const errorDispositions: Readonly<Record<VisionErrorCode, ErrorDisposition>> = {
  INPUT_INVALID: {
    retryable: false,
    userActionRequired: false,
    nextAction: 'Do not retry unchanged. Correct the arguments using the analyze_images Tool input schema.',
  },
  CONFIG_INVALID: {
    retryable: false,
    userActionRequired: true,
    nextAction: 'Do not retry. Ask the user to correct the named MCP server environment fields and restart the server.',
  },
  SOURCE_UNSUPPORTED: {
    retryable: false,
    userActionRequired: true,
    nextAction: 'Do not retry the same source. Provide a supported JPEG, PNG, WebP, or GIF image.',
  },
  SOURCE_TOO_LARGE: {
    retryable: false,
    userActionRequired: true,
    nextAction: 'Do not retry unchanged. Resize or recompress the image below the reported limit, then call again.',
  },
  DECODE_FAILED: {
    retryable: false,
    userActionRequired: true,
    nextAction: 'Do not retry the same bytes. Ask the user for a valid, non-corrupted supported image.',
  },
  PIXEL_LIMIT_EXCEEDED: {
    retryable: false,
    userActionRequired: true,
    nextAction: 'Do not retry unchanged. Resize the image below the decoded-pixel limit, then call again.',
  },
  FILE_ACCESS_DENIED: {
    retryable: false,
    userActionRequired: true,
    nextAction:
      'Do not retry the same file URI. Ask the user to verify the file exists and is allowed by VISION_ALLOWED_FILE_ROOTS.',
  },
  URL_ACCESS_DENIED: {
    retryable: false,
    userActionRequired: true,
    nextAction:
      'Do not retry the same URL. Ask the user for an allowed HTTP(S) image URL or a permitted network configuration.',
  },
  UPSTREAM_ERROR: {
    retryable: true,
    userActionRequired: false,
    nextAction: 'Retry once. If the same upstream failure happens again, stop and notify the user.',
  },
  UPSTREAM_TIMEOUT: {
    retryable: true,
    userActionRequired: false,
    nextAction: 'Retry once. If the same timeout happens again, stop and notify the user.',
  },
  UPSTREAM_AUTH_FAILED: {
    retryable: false,
    userActionRequired: true,
    nextAction: 'Do not retry. Ask the user to verify VISION_API_KEY, VISION_BASE_URL, and VISION_MODEL.',
  },
  UPSTREAM_RATE_LIMITED: {
    retryable: true,
    userActionRequired: false,
    nextAction: 'Wait before retrying once. If rate limiting continues, stop and notify the user.',
  },
  UPSTREAM_INVALID_RESPONSE: {
    retryable: false,
    userActionRequired: true,
    nextAction:
      'Do not retry automatically. Notify the user that the endpoint is not returning a compatible Chat Completions response.',
  },
  INTERNAL_ERROR: {
    retryable: false,
    userActionRequired: true,
    nextAction: 'Do not retry automatically. Notify the user and ask them to inspect the MCP server diagnostics.',
  },
}

export class VisionError extends Error {
  readonly code: VisionErrorCode
  readonly safeMessage: string
  readonly retryable: boolean
  readonly userActionRequired: boolean
  readonly nextAction: string
  readonly details: SafeIssueDetails | undefined

  constructor(code: VisionErrorCode, safeMessage: string, options: VisionErrorOptions = {}) {
    const disposition = errorDispositions[code]
    super(`${code}: ${safeMessage}`, { cause: options.cause })
    this.name = 'VisionError'
    this.code = code
    this.safeMessage = safeMessage
    this.retryable = options.retryable ?? disposition.retryable
    this.userActionRequired = options.userActionRequired ?? disposition.userActionRequired
    this.nextAction = options.nextAction ?? disposition.nextAction
    this.details = options.details
  }

  toIssue(): ActionableIssue {
    return {
      code: this.code,
      message: this.safeMessage,
      retryable: this.retryable,
      userActionRequired: this.userActionRequired,
      nextAction: this.nextAction,
      ...(this.details === undefined ? {} : { details: this.details }),
    }
  }
}

export function formatActionableIssue(issue: ActionableIssue): string {
  return [
    `Error code: ${issue.code}`,
    `Message: ${issue.message}`,
    `Retryable: ${issue.retryable ? 'yes' : 'no'}`,
    `User action required: ${issue.userActionRequired ? 'yes' : 'no'}`,
    `Next action: ${issue.nextAction}`,
  ].join('\n')
}

export function toSafeError(error: unknown): VisionError {
  if (error instanceof VisionError) return error

  return new VisionError('INTERNAL_ERROR', 'The vision server encountered an unexpected internal error.', {
    retryable: false,
    userActionRequired: true,
    nextAction: 'Do not retry automatically. Notify the user and ask them to inspect the MCP server diagnostics.',
    cause: error,
  })
}
