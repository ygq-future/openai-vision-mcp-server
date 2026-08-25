#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { loadConfig } from './config.js'
import { SERVER_INFO } from './constants.js'
import { toSafeError } from './errors.js'
import { createLogger } from './logger.js'
import { createServer } from './server.js'

export const packageName = SERVER_INFO.name

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
if (entryPath !== undefined && realpathSync(resolve(entryPath)) === realpathSync(fileURLToPath(import.meta.url))) {
  const logger = createLogger()
  main().catch((error: unknown) => {
    const safe = toSafeError(error)
    logger.error('fatal', { code: safe.code, message: safe.safeMessage })
    process.exitCode = 1
  })
}
