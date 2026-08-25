import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/client'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'

describe('MCP stdio server', () => {
  let upstreamStatus = 200
  const upstream = createServer((_request, response) => {
    if (upstreamStatus !== 200) {
      response.writeHead(upstreamStatus).end('secret upstream body')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                overview: 'A one-pixel image',
                overviewSufficient: true,
                contentKinds: ['photo'],
                regions: [],
                uncertainties: [],
              }),
            },
            finish_reason: 'stop',
          },
        ],
      }),
    )
  })
  let origin = ''

  beforeAll(async () => {
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${String((upstream.address() as AddressInfo).port)}`
  })
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      upstream.close(error => {
        if (error) reject(error)
        else resolve()
      }),
    )
  })

  test('lists and calls exactly one analyze_images tool over clean stdio', async () => {
    const png = (
      await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } })
        .png()
        .toBuffer()
    ).toString('base64')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/index.js'],
      cwd: process.cwd(),
      stderr: 'pipe',
      env: {
        ...getDefaultEnvironment(),
        VISION_BASE_URL: origin,
        VISION_API_KEY: 'test-key',
        VISION_MODEL: 'test-model',
      },
    })
    const stderr: string[] = []
    transport.stderr?.on('data', chunk => stderr.push(String(chunk)))
    const client = new Client({ name: 'integration-test', version: '1.0.0' })
    try {
      await client.connect(transport)
      const listing = await client.listTools()
      expect(listing.tools.map(tool => tool.name)).toEqual(['analyze_images'])
      expect(listing.tools[0]?.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      })
      const maxTiles = (
        listing.tools[0]?.inputSchema.properties as Record<string, { description?: string }> | undefined
      )?.maxTiles
      expect(maxTiles?.description).toContain('Hard ceiling')

      const result = await client.callTool({
        name: 'analyze_images',
        arguments: {
          prompt: 'Describe',
          images: [{ type: 'base64', data: png, mediaType: 'image/png' }],
          coverage: 'overview',
        },
      })
      expect(result.isError).not.toBe(true)
      expect(result.content[0]).toMatchObject({ type: 'text', text: 'A one-pixel image' })
      expect(result.structuredContent).toMatchObject({ sourceCount: 1, detailTiles: 0, apiCalls: 1 })

      upstreamStatus = 401
      const errorResult = await client.callTool({
        name: 'analyze_images',
        arguments: {
          prompt: 'Describe',
          images: [{ type: 'base64', data: png, mediaType: 'image/png' }],
          coverage: 'overview',
        },
      })
      expect(errorResult.isError).toBe(true)
      expect(errorResult.structuredContent).toMatchObject({
        error: {
          code: 'UPSTREAM_AUTH_FAILED',
          retryable: false,
          userActionRequired: true,
          nextAction: 'Do not retry. Ask the user to verify VISION_API_KEY, VISION_BASE_URL, and VISION_MODEL.',
        },
      })
      expect(JSON.stringify(errorResult)).not.toContain('secret upstream body')
      expect(stderr.join('')).not.toContain('test-key')
    } finally {
      upstreamStatus = 200
      await client.close()
    }
  })
})
