export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Readonly<Record<string, unknown>>
export type LogWriter = (line: string) => unknown

export interface Logger {
  debug(event: string, fields?: LogFields): void
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
  error(event: string, fields?: LogFields): void
}

const redactedKeys = new Set(['authorization', 'apikey', 'key', 'data', 'base64', 'image'])

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'

  seen.add(value)
  if (Array.isArray(value)) return value.map(item => sanitize(item, seen))

  if (value instanceof Error) {
    return { name: value.name, message: value.message }
  }

  return sanitizeRecord(value as Record<string, unknown>, seen)
}

function sanitizeRecord(value: Readonly<Record<string, unknown>>, seen: WeakSet<object>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      redactedKeys.has(key.toLowerCase()) ? '[REDACTED]' : sanitize(item, seen),
    ]),
  )
}

export function createLogger(write: LogWriter = line => process.stderr.write(line)): Logger {
  const log = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...sanitizeRecord(fields, new WeakSet()),
    }
    write(`${JSON.stringify(record)}\n`)
  }

  return {
    debug: (event, fields) => {
      log('debug', event, fields)
    },
    info: (event, fields) => {
      log('info', event, fields)
    },
    warn: (event, fields) => {
      log('warn', event, fields)
    },
    error: (event, fields) => {
      log('error', event, fields)
    },
  }
}
