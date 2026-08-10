import type { VisionConfig } from '../config.js'
import { UPSTREAM_POLICY } from '../constants.js'
import { VisionError } from '../errors.js'
import type { EncodedImage } from '../image/types.js'
import { chatCompletionResponseSchema } from './schemas.js'

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface VisionCompletionRequest {
  prompt: string
  images: readonly EncodedImage[]
  maxTokens?: number
}

export interface VisionCompletion {
  text: string
  finishReason: string | null
  usage: {
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
  }
}

export interface VisionClient {
  complete(request: VisionCompletionRequest): Promise<VisionCompletion>
}

export interface VisionClientDependencies {
  fetch?: FetchLike
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
}

const retryableStatuses = new Set<number>(UPSTREAM_POLICY.retryableStatuses)
const authenticationStatuses = new Set<number>(UPSTREAM_POLICY.authenticationStatuses)
const defaultSleep = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds))

function retryDelay(response: Response, attempt: number, random: () => number): number {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter !== null && /^\d+(?:\.\d+)?$/.test(retryAfter)) {
    return Math.min(Number(retryAfter) * UPSTREAM_POLICY.retryAfterMillisecondsPerSecond, UPSTREAM_POLICY.maxDelayMs)
  }
  return Math.min(
    UPSTREAM_POLICY.baseDelayMs * 2 ** attempt + Math.floor(random() * UPSTREAM_POLICY.jitterMs),
    UPSTREAM_POLICY.maxDelayMs,
  )
}

function hasJsonMediaType(response: Response): boolean {
  const contentType = response.headers.get('content-type')
  if (contentType === null) return true

  const mediaType = contentType.split(';')[0]?.trim().toLowerCase()
  return (
    mediaType === 'application/json' || Boolean(mediaType?.startsWith('application/') && mediaType.endsWith('+json'))
  )
}

function parseCompletion(value: unknown): VisionCompletion {
  const parsed = chatCompletionResponseSchema.safeParse(value)
  if (!parsed.success) {
    throw new VisionError('UPSTREAM_INVALID_RESPONSE', 'The vision API response does not match Chat Completions.', {
      details: { stage: 'vision_api_response' },
    })
  }
  const choice = parsed.data.choices[0]
  if (!choice) {
    throw new VisionError('UPSTREAM_INVALID_RESPONSE', 'The vision API response contains no completion choice.', {
      details: { stage: 'vision_api_response' },
    })
  }
  const content = choice.message.content
  const text = (typeof content === 'string' ? content : content.map(part => part.text).join('\n')).trim()
  if (!text) {
    throw new VisionError('UPSTREAM_INVALID_RESPONSE', 'The vision API returned an empty completion.', {
      details: { stage: 'vision_api_response' },
    })
  }
  return {
    text,
    finishReason: choice.finish_reason ?? null,
    usage: {
      promptTokens: parsed.data.usage?.prompt_tokens ?? null,
      completionTokens: parsed.data.usage?.completion_tokens ?? null,
      totalTokens: parsed.data.usage?.total_tokens ?? null,
    },
  }
}

export function createVisionClient(config: VisionConfig, dependencies: VisionClientDependencies = {}): VisionClient {
  const requestFetch = dependencies.fetch ?? fetch
  const sleep = dependencies.sleep ?? defaultSleep
  const random = dependencies.random ?? Math.random

  return {
    async complete(request) {
      const content = [
        { type: 'text', text: request.prompt },
        ...request.images.map(image => ({
          type: 'image_url',
          image_url: { url: `data:${image.mediaType};base64,${image.buffer.toString('base64')}` },
        })),
      ]
      const body = JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content }],
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
      })

      for (let attempt = 0; attempt < UPSTREAM_POLICY.maxAttempts; attempt += 1) {
        const controller = new AbortController()
        const timeout = setTimeout(() => {
          controller.abort()
        }, config.httpTimeoutMs)
        let response: Response
        try {
          response = await requestFetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
            body,
            signal: controller.signal,
          })
        } catch (error) {
          clearTimeout(timeout)
          if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
            throw new VisionError('UPSTREAM_TIMEOUT', 'The vision API request timed out.', {
              details: { stage: 'vision_api' },
              cause: error,
            })
          }
          throw new VisionError('UPSTREAM_ERROR', 'The vision API request failed before receiving a response.', {
            details: { stage: 'vision_api' },
            cause: error,
          })
        }
        clearTimeout(timeout)

        if (response.ok) {
          if (!hasJsonMediaType(response)) {
            throw new VisionError('UPSTREAM_INVALID_RESPONSE', 'The vision API returned a non-JSON response.', {
              details: { stage: 'vision_api_response' },
            })
          }
          let value: unknown
          try {
            value = await response.json()
          } catch (error) {
            throw new VisionError('UPSTREAM_INVALID_RESPONSE', 'The vision API returned invalid JSON.', {
              details: { stage: 'vision_api_response' },
              cause: error,
            })
          }
          return parseCompletion(value)
        }
        if (authenticationStatuses.has(response.status)) {
          throw new VisionError('UPSTREAM_AUTH_FAILED', 'The vision API rejected the configured credentials.', {
            details: { stage: 'vision_api', httpStatus: response.status },
          })
        }
        if (retryableStatuses.has(response.status) && attempt < UPSTREAM_POLICY.maxAttempts - 1) {
          await sleep(retryDelay(response, attempt, random))
          continue
        }
        if (response.status === UPSTREAM_POLICY.rateLimitedStatus) {
          throw new VisionError(
            'UPSTREAM_RATE_LIMITED',
            'The vision API is still rate limiting after bounded retries.',
            {
              details: { stage: 'vision_api', httpStatus: response.status },
            },
          )
        }
        const retryable = retryableStatuses.has(response.status)
        throw new VisionError('UPSTREAM_ERROR', `The vision API returned HTTP ${String(response.status)}.`, {
          retryable,
          userActionRequired: !retryable,
          nextAction: retryable
            ? 'Retry once. If the same vision API failure happens again, stop and notify the user.'
            : 'Do not retry unchanged. Ask the user to verify the endpoint, model, and request compatibility.',
          details: { stage: 'vision_api', httpStatus: response.status },
        })
      }
      throw new VisionError('UPSTREAM_ERROR', 'The vision API request exhausted its bounded attempts.', {
        details: { stage: 'vision_api' },
      })
    },
  }
}
