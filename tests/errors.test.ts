import { describe, expect, test } from 'bun:test'
import { VisionError, formatActionableIssue, toSafeError } from '../src/errors.js'

describe('actionable error contract', () => {
  test('serializes a permanent authentication failure without its cause', () => {
    const error = new VisionError('UPSTREAM_AUTH_FAILED', 'The vision API rejected authentication.', {
      retryable: false,
      userActionRequired: true,
      nextAction: 'Do not retry. Ask the user to verify VISION_API_KEY, VISION_BASE_URL, and VISION_MODEL.',
      details: { stage: 'vision_api', httpStatus: 401 },
      cause: new Error('Bearer secret-token'),
    })

    expect(error.toIssue()).toEqual({
      code: 'UPSTREAM_AUTH_FAILED',
      message: 'The vision API rejected authentication.',
      retryable: false,
      userActionRequired: true,
      nextAction: 'Do not retry. Ask the user to verify VISION_API_KEY, VISION_BASE_URL, and VISION_MODEL.',
      details: { stage: 'vision_api', httpStatus: 401 },
    })
    const text = formatActionableIssue(error.toIssue())
    expect(text).toContain('Error code: UPSTREAM_AUTH_FAILED')
    expect(text).toContain('Retryable: no')
    expect(text).toContain('User action required: yes')
    expect(text).toContain('Do not retry')
    expect(text).not.toContain('secret-token')
  })

  test('marks a transient timeout for one bounded caller retry', () => {
    const error = new VisionError('UPSTREAM_TIMEOUT', 'The vision API request timed out.', {
      retryable: true,
      userActionRequired: false,
      nextAction: 'Retry once. If the same timeout happens again, stop and notify the user.',
    })

    expect(error.toIssue()).toMatchObject({
      retryable: true,
      userActionRequired: false,
      nextAction: 'Retry once. If the same timeout happens again, stop and notify the user.',
    })
  })

  test('converts unknown failures into a safe stop-and-notify error', () => {
    const error = toSafeError(new Error('private path D:/secret/image.png'))

    expect(error.toIssue()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'The vision server encountered an unexpected internal error.',
      retryable: false,
      userActionRequired: true,
      nextAction: 'Do not retry automatically. Notify the user and ask them to inspect the MCP server diagnostics.',
    })
    expect(formatActionableIssue(error.toIssue())).not.toContain('D:/secret/image.png')
  })
})
