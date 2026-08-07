import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VisionError } from '../errors.js'

const denied = (cause?: unknown): VisionError =>
  new VisionError('FILE_ACCESS_DENIED', 'The local file is not accessible', { cause })

export async function assertAllowedFileUri(uri: string, allowedRoots: readonly string[]): Promise<string> {
  if (allowedRoots.length === 0) throw denied()

  let targetPath: string
  try {
    const url = new URL(uri)
    if (url.protocol !== 'file:') throw denied()
    targetPath = await realpath(fileURLToPath(url))
  } catch (error) {
    if (error instanceof VisionError) throw error
    throw denied(error)
  }

  const canonicalRoots = await Promise.all(
    allowedRoots.map(async root => {
      try {
        return await realpath(root)
      } catch (error) {
        throw denied(error)
      }
    }),
  )
  const insideRoot = canonicalRoots.some(root => {
    const pathFromRoot = relative(root, targetPath)
    return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
  })
  if (!insideRoot) throw denied()

  try {
    if (!(await stat(targetPath)).isFile()) throw denied()
  } catch (error) {
    if (error instanceof VisionError) throw error
    throw denied(error)
  }
  return targetPath
}
