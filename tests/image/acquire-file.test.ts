import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { acquireImage } from '../../src/image/acquire.js'

describe('file acquisition', () => {
  let directory = ''
  let file = ''

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vision-mcp-acquire-'))
    file = join(directory, 'image.png')
    await writeFile(file, Buffer.from('89504e470d0a1a0a', 'hex'))
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  test('reads an allowed file and detects its media type', async () => {
    const result = await acquireImage(
      { type: 'file', uri: pathToFileURL(file).href, label: 'page' },
      { maxInputBytes: 8, allowedFileRoots: [directory], allowPrivateNetwork: false },
    )
    expect(result.declaredMediaType).toBe('image/png')
    expect(result.sourceName).toBe('page')
  })

  test('rejects a file above the byte limit before returning data', () => {
    expect(
      acquireImage(
        { type: 'file', uri: pathToFileURL(file).href },
        { maxInputBytes: 7, allowedFileRoots: [directory], allowPrivateNetwork: false },
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' })
  })
})
