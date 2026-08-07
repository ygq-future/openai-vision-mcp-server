import { expect, test } from 'bun:test'
import { createLogger } from '../src/logger.js'

test('logger recursively redacts credentials and image payloads', () => {
  const lines: string[] = []
  const logger = createLogger(line => lines.push(line))

  logger.error('request_failed', {
    authorization: 'Bearer secret',
    apiKey: 'secret',
    nested: { key: 'secret', data: 'aGVsbG8=', safe: 'kept' },
    images: [{ base64: 'aGVsbG8=' }],
    requestId: 'req-1',
  })

  expect(lines).toHaveLength(1)
  expect(lines[0]?.endsWith('\n')).toBe(true)
  expect(lines.join('')).not.toContain('secret')
  expect(lines.join('')).not.toContain('aGVsbG8=')
  expect(lines.join('')).toContain('req-1')
  expect(lines.join('')).toContain('kept')

  const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
  expect(record.level).toBe('error')
  expect(record.event).toBe('request_failed')
  expect(record.timestamp).toBeString()
})
