import { describe, expect, test } from 'bun:test'
import { createVisionClient } from '../../src/openai/client.js'
import type { VisionConfig } from '../../src/config.js'
import type { FetchLike } from '../../src/openai/client.js'

const config: VisionConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'secret',
  model: 'vision-model',
  defaultMaxTiles: 24,
  maxInputBytes: 20_971_520,
  maxDecodedPixels: 40_000_000,
  httpTimeoutMs: 1_000,
  maxRedirects: 3,
  maxConcurrency: 2,
  allowedFileRoots: [],
  allowPrivateNetwork: false,
}

const success = (content: unknown = 'answer'): Response =>
  Response.json({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })

describe('OpenAI-compatible vision client', () => {
  test('sends text followed by image_url blocks and parses usage', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const mockFetch: FetchLike = (url, init) => {
      capturedUrl = String(url)
      capturedInit = init
      return Promise.resolve(
        success([
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ]),
      )
    }
    const client = createVisionClient(config, { fetch: mockFetch })
    const result = await client.complete({
      prompt: 'describe',
      images: [{ buffer: Buffer.from('webp'), mediaType: 'image/webp', width: 2, height: 2, bytes: 4 }],
    })

    expect(capturedUrl).toBe('https://api.example.com/v1/chat/completions')
    expect(new Headers(capturedInit?.headers).get('authorization')).toBe('Bearer secret')
    if (typeof capturedInit?.body !== 'string') throw new TypeError('Expected a string request body')
    const body = JSON.parse(capturedInit.body) as { messages: { content: unknown[] }[] }
    expect(body.messages[0]?.content).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image_url', image_url: { url: `data:image/webp;base64,${Buffer.from('webp').toString('base64')}` } },
    ])
    expect(result).toEqual({
      text: 'first\nsecond',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
  })

  test('retries 429 and 503 but does not sleep in tests', async () => {
    const statuses = [429, 503, 200]
    const delays: number[] = []
    const fetch: FetchLike = () => {
      const status = statuses.shift() ?? 200
      return Promise.resolve(status === 200 ? success() : new Response('error', { status }))
    }
    const client = createVisionClient(config, {
      fetch,
      sleep: delay => {
        delays.push(delay)
        return Promise.resolve()
      },
      random: () => 0,
    })
    const result = await client.complete({ prompt: 'describe', images: [] })
    expect(result).toMatchObject({ text: 'answer' })
    expect(delays).toEqual([250, 500])
  })

  test.each([
    [401, 'UPSTREAM_AUTH_FAILED'],
    [400, 'UPSTREAM_ERROR'],
  ] as const)('does not retry HTTP %s', async (status, code) => {
    let calls = 0
    const fetch: FetchLike = () => {
      calls += 1
      return Promise.resolve(new Response('error', { status }))
    }
    const client = createVisionClient(config, { fetch })
    expect(client.complete({ prompt: 'describe', images: [] })).rejects.toMatchObject({ code })
    await Promise.resolve()
    expect(calls).toBe(1)
  })

  test('maps timeout and invalid responses safely', () => {
    const timeoutClient = createVisionClient(config, {
      fetch: () => Promise.reject(new DOMException('timed out', 'AbortError')),
    })
    expect(timeoutClient.complete({ prompt: 'describe', images: [] })).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
    })

    const invalidJson = createVisionClient(config, { fetch: () => Promise.resolve(new Response('{', { status: 200 })) })
    expect(invalidJson.complete({ prompt: 'describe', images: [] })).rejects.toMatchObject({
      code: 'UPSTREAM_INVALID_RESPONSE',
    })

    const invalidBody = createVisionClient(config, { fetch: () => Promise.resolve(Response.json({ choices: [] })) })
    expect(invalidBody.complete({ prompt: 'describe', images: [] })).rejects.toMatchObject({
      code: 'UPSTREAM_INVALID_RESPONSE',
    })
  })
})
