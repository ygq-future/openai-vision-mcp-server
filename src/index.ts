#!/usr/bin/env node

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { loadConfig } from './config.js'
import { toSafeError } from './errors.js'
import { createLogger } from './logger.js'
import { createServer } from './server.js'

export const packageName = 'openai-vision-mcp-server'

export async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const server = createServer({ config })
  const transport = new StdioServerTransport()
  let closing = false
  const close = async (): Promise<void> => {
    if (closing) return
    closing = true
    await server.close()
  }
  process.once('SIGINT', () => {
    void close()
  })
  process.once('SIGTERM', () => {
    void close()
  })
  await server.connect(transport)
}

const entryPath = process.argv[1]
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  const logger = createLogger()
  main().catch((error: unknown) => {
    const safe = toSafeError(error)
    logger.error('fatal', { code: safe.code, message: safe.safeMessage })
    process.exitCode = 1
  })
}
