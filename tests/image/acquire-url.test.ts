import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { acquireImage } from '../../src/image/acquire.js'

const png = Buffer.from('89504e470d0a1a0a', 'hex')

describe('remote image acquisition', () => {
  const server = createServer((request, response) => {
    if (request.url === '/image') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
      response.end(png)
    } else if (request.url === '/redirect') {
      response.writeHead(302, { location: '/image' }).end()
    } else if (request.url === '/loop') {
      response.writeHead(302, { location: '/loop' }).end()
    } else if (request.url === '/text') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('hello')
    } else if (request.url === '/large') {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.write(png)
      response.end(Buffer.alloc(32))
    } else if (request.url === '/slow') {
      setTimeout(() => response.writeHead(200, { 'content-type': 'image/png' }).end(png), 100)
    } else if (request.url === '/unavailable') {
      response.writeHead(503).end()
    } else {
      response.writeHead(404).end()
    }
  })
  let origin = ''

  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    origin = `http://127.0.0.1:${String(address.port)}`
  })
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close(error => {
        if (error) reject(error)
        else resolve()
      }),
    )
  })

  const context = {
    maxInputBytes: 32,
    allowedFileRoots: [],
    allowPrivateNetwork: true,
    httpTimeoutMs: 1_000,
    maxRedirects: 2,
  }

  test('downloads a PNG and follows a revalidated redirect', async () => {
    const direct = await acquireImage({ type: 'url', url: `${origin}/image` }, context)
    const redirected = await acquireImage({ type: 'url', url: `${origin}/redirect`, label: 'remote' }, context)
    expect(direct.buffer).toEqual(png)
    expect(redirected.sourceName).toBe('remote')
  })

  test('rejects redirect overflow, non-images, streamed overflow, and timeout', () => {
    expect(acquireImage({ type: 'url', url: `${origin}/loop` }, { ...context, maxRedirects: 1 })).rejects.toMatchObject(
      {
        code: 'URL_ACCESS_DENIED',
      },
    )
    expect(acquireImage({ type: 'url', url: `${origin}/text` }, context)).rejects.toMatchObject({
      code: 'SOURCE_UNSUPPORTED',
    })
    expect(
      acquireImage({ type: 'url', url: `${origin}/large` }, { ...context, maxInputBytes: 16 }),
    ).rejects.toMatchObject({
      code: 'SOURCE_TOO_LARGE',
    })
    expect(
      acquireImage({ type: 'url', url: `${origin}/slow` }, { ...context, httpTimeoutMs: 10 }),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
      retryable: true,
      userActionRequired: false,
      nextAction: 'Retry once. If the same timeout happens again, stop and notify the user.',
    })
  })

  test('distinguishes permanent source HTTP errors from retryable server failures', () => {
    expect(acquireImage({ type: 'url', url: `${origin}/missing` }, context)).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      retryable: false,
      userActionRequired: true,
      nextAction: 'Do not retry the same URL. Ask the user to verify it or provide a different image URL.',
      details: { stage: 'image_fetch', httpStatus: 404 },
    })
    expect(acquireImage({ type: 'url', url: `${origin}/unavailable` }, context)).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      retryable: true,
      userActionRequired: false,
      nextAction: 'Retry once. If the same image server failure happens again, stop and notify the user.',
      details: { stage: 'image_fetch', httpStatus: 503 },
    })
  })
})
