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
  httpTimeoutMs?: number
  maxRedirects?: number
}

export interface NormalizedImage {
  pixels: Buffer
  width: number
  height: number
  channels: 3
  sourceFormat: string
  sourceName: string
  selectedFrames: 1
}

export interface EncodedImage {
  buffer: Buffer
  mediaType: 'image/webp'
  width: number
  height: number
  bytes: number
}
