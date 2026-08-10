const KIBIBYTE = 1_024
const MEBIBYTE = KIBIBYTE * KIBIBYTE
const HTTP_STATUS_TOO_MANY_REQUESTS = 429

export const SERVER_INFO = {
  name: 'openai-vision-mcp-server',
  version: '0.1.9',
} as const

export const TOOL_LIMITS = {
  labelLength: { min: 1, max: 500 },
  promptLength: { min: 1, max: 20_000 },
  imagesPerCall: { min: 1, max: 10 },
  detailTiles: { min: 1, max: 64, default: 24 },
} as const

export const CONFIG_LIMITS = {
  maxInputBytes: { min: KIBIBYTE, max: 100 * MEBIBYTE, default: 20 * MEBIBYTE },
  maxDecodedPixels: { min: 1_000_000, max: 400_000_000, default: 100_000_000 },
  httpTimeoutMs: { min: 100, max: 300_000, default: 30_000 },
  maxRedirects: { min: 0, max: 10, default: 3 },
  maxConcurrency: { min: 1, max: 16, default: 1 },
} as const

export const IMAGE_POLICY = {
  remoteFetch: { fallbackTimeoutMs: 15_000 },
  overview: {
    maxEdge: 2_048,
    maxPixels: 4_000_000,
    maxBytes: 3 * MEBIBYTE,
    highestQuality: 90,
    lowestQuality: 70,
    qualitySearchMin: 71,
    qualitySearchMax: 89,
    scaleDownFactor: 0.9,
    minEdge: 256,
  },
  detailTile: {
    maxBytes: 1.5 * MEBIBYTE,
    photoQuality: 82,
    fallbackQualities: [90, 85, 80, 75],
  },
  grid: { tileSize: 1_024, overlap: 128, preferredRegionMargin: 0.15 },
} as const

export const UPSTREAM_POLICY = {
  retryableStatuses: [HTTP_STATUS_TOO_MANY_REQUESTS, 500, 502, 503, 504],
  authenticationStatuses: [401, 403],
  rateLimitedStatus: HTTP_STATUS_TOO_MANY_REQUESTS,
  maxAttempts: 3,
  retryAfterMillisecondsPerSecond: 1_000,
  baseDelayMs: 250,
  jitterMs: 100,
  maxDelayMs: 10_000,
} as const

export const ANALYSIS_POLICY = {
  detailTilesPerBatch: 6,
} as const
