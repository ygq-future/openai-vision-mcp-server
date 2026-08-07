export type SupportedImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

export interface AcquiredImage {
  buffer: Buffer
  declaredMediaType: SupportedImageMediaType
  sourceKind: 'file' | 'url' | 'base64'
  sourceName: string
}

export interface AcquisitionContext {
  maxInputBytes: number
  allowedFileRoots: string[]
  allowPrivateNetwork: boolean
}
