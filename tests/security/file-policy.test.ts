import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertAllowedFileUri } from '../../src/security/file-policy.js'

describe('local file policy', () => {
  let sandbox = ''
  let allowed = ''
  let inside = ''
  let outside = ''

  beforeAll(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'vision-mcp-file-'))
    allowed = join(sandbox, 'allowed')
    inside = join(allowed, 'inside.png')
    outside = join(sandbox, 'outside.png')
    await mkdir(allowed)
    await writeFile(inside, Buffer.from('inside'))
    await writeFile(outside, Buffer.from('outside'))
  })

  afterAll(async () => {
    await rm(sandbox, { recursive: true, force: true })
  })

  test('returns a canonical regular file inside an allowed root', () => {
    expect(assertAllowedFileUri(pathToFileURL(inside).href, [allowed])).resolves.toBe(inside)
  })

  test('allows files inside current working directory process.cwd() by default', () => {
    const cwdFile = join(process.cwd(), 'package.json')
    expect(assertAllowedFileUri(pathToFileURL(cwdFile).href, [process.cwd()])).resolves.toBe(cwdFile)
  })

  test('rejects absent roots, non-file URIs, outside files, and directories', () => {
    expect(assertAllowedFileUri(pathToFileURL(inside).href, [])).rejects.toMatchObject({
      code: 'FILE_ACCESS_DENIED',
    })
    expect(assertAllowedFileUri('https://example.com/a.png', [allowed])).rejects.toMatchObject({
      code: 'FILE_ACCESS_DENIED',
    })
    expect(assertAllowedFileUri(pathToFileURL(outside).href, [allowed])).rejects.toMatchObject({
      code: 'FILE_ACCESS_DENIED',
    })
    expect(assertAllowedFileUri(pathToFileURL(allowed).href, [allowed])).rejects.toMatchObject({
      code: 'FILE_ACCESS_DENIED',
    })
  })

  test('rejects a symbolic link escaping the allowed root when supported', async () => {
    const link = join(allowed, 'escape.png')
    try {
      await symlink(outside, link, 'file')
    } catch {
      return
    }
    expect(assertAllowedFileUri(pathToFileURL(link).href, [allowed])).rejects.toMatchObject({
      code: 'FILE_ACCESS_DENIED',
    })
  })
})
