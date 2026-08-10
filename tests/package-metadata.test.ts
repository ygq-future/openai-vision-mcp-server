import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

describe('package metadata', () => {
  test('publishes the expected executable for Node 20.19+', async () => {
    const json = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as unknown

    expect(json).toMatchObject({
      name: 'openai-vision-mcp-server',
      version: '0.1.9',
      type: 'module',
      bin: { 'openai-vision-mcp-server': './dist/index.js' },
      engines: { node: '>=20.19.0' },
      packageManager: 'bun@1.3.14',
    })
  })
})
