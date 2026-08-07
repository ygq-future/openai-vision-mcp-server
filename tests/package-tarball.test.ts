import { afterAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', code => {
      resolveResult({ code, stdout, stderr })
    })
  })
}

describe('npm package tarball', () => {
  let tarball = ''
  let temporaryDirectory = ''

  afterAll(async () => {
    if (tarball) await rm(tarball, { force: true })
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  })

  test('contains only publishable files and runs through npx', async () => {
    const build = await run(process.execPath, ['run', 'build'], { cwd: process.cwd(), env: process.env })
    expect(build.code).toBe(0)

    const packed = await run(process.execPath, ['pm', 'pack', '--quiet'], { cwd: process.cwd(), env: process.env })
    expect(packed.code).toBe(0)
    const outputPath = packed.stdout.trim().split(/\r?\n/).at(-1)
    if (!outputPath?.endsWith('.tgz')) throw new Error(`Pack did not return a tarball path: ${packed.stdout}`)
    tarball = isAbsolute(outputPath) ? outputPath : resolve(outputPath)

    const listing = await run('tar', ['-tf', tarball])
    expect(listing.code).toBe(0)
    const entries = listing.stdout.trim().split(/\r?\n/)
    expect(entries).toContain('package/package.json')
    expect(entries).toContain('package/LICENSE')
    expect(entries).toContain('package/dist/index.js')
    expect(
      entries.some(entry =>
        ['package/src/', 'package/tests/', 'package/docs/', 'package/.planning/', 'package/.codex/'].some(prefix =>
          entry.startsWith(prefix),
        ),
      ),
    ).toBe(false)
    expect(entries.some(entry => /(?:^|\/)\.env(?:\.|$)/.test(entry))).toBe(false)

    temporaryDirectory = await mkdtemp(join(tmpdir(), 'vision-mcp-packed-'))
    const cleanEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([key, value]) => !key.startsWith('VISION_') && value !== undefined),
    )
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const execution = await run(npx, ['--yes', '--package', tarball, 'openai-vision-mcp-server'], {
      cwd: temporaryDirectory,
      env: cleanEnvironment,
    })
    expect(execution.code).toBe(1)
    expect(execution.stdout).toBe('')
    expect(execution.stderr).toContain('CONFIG_INVALID')
    expect(execution.stderr).not.toContain('VISION_API_KEY=')
  }, 30_000)
})
