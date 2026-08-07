import type { TileBounds } from '../image/tiles.js'
import type { EncodedImage } from '../image/types.js'
import type { VisionClient, VisionCompletion } from '../openai/client.js'
import type { AnalysisSegment, AnalysisWarning } from '../tools/analyze-images/schema.js'

export interface DetailTile {
  imageIndex: number
  tileIndex: number
  bounds: TileBounds
  encoded: EncodedImage
}

export interface TokenUsage {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

export interface DetailAnalysisResult {
  segments: AnalysisSegment[]
  warnings: AnalysisWarning[]
  complete: boolean
  usage: TokenUsage
  apiCalls: number
}

export interface DetailAnalysisInput {
  tiles: readonly DetailTile[]
  userPrompt: string
  client: VisionClient
  maxConcurrency: number
}

function sumUsage(completions: readonly VisionCompletion[]): TokenUsage {
  const sum = (field: keyof TokenUsage): number | null => {
    const values = completions.map(completion => completion.usage[field])
    return values.length > 0 && values.every(value => value !== null)
      ? values.reduce<number>((total, value) => total + value, 0)
      : null
  }
  return {
    promptTokens: sum('promptTokens'),
    completionTokens: sum('completionTokens'),
    totalTokens: sum('totalTokens'),
  }
}

function detailPrompt(userPrompt: string, batch: readonly DetailTile[]): string {
  const labels = batch
    .map(
      tile =>
        `image=${String(tile.imageIndex)} tile=${String(tile.tileIndex)} bounds=(${String(tile.bounds.x)},${String(tile.bounds.y)},${String(tile.bounds.width)},${String(tile.bounds.height)})`,
    )
    .join('\n')
  return `Analyze these high-resolution static image crop tiles (these are still image crops, NOT a video) for the user's request: ${JSON.stringify(userPrompt)}\n${labels}\nReport all text, UI elements, and visual observations found inside these static tiles with their image and tile labels. Do not infer content outside these bounds.`
}

export async function analyzeDetailTiles(input: DetailAnalysisInput): Promise<DetailAnalysisResult> {
  const batches = Array.from({ length: Math.ceil(input.tiles.length / 6) }, (_, index) =>
    input.tiles.slice(index * 6, index * 6 + 6),
  )
  const completions: (VisionCompletion | undefined)[] = Array.from({ length: batches.length })
  const failures = new Set<number>()
  let nextBatch = 0

  const worker = async (): Promise<void> => {
    while (nextBatch < batches.length) {
      const batchIndex = nextBatch
      nextBatch += 1
      const batch = batches[batchIndex]
      if (!batch) continue
      try {
        completions[batchIndex] = await input.client.complete({
          prompt: detailPrompt(input.userPrompt, batch),
          images: batch.map(tile => tile.encoded),
        })
      } catch {
        failures.add(batchIndex)
      }
    }
  }
  const workerCount = Math.min(Math.max(1, Math.floor(input.maxConcurrency)), batches.length)
  await Promise.all(Array.from({ length: workerCount }, worker))

  const segments: AnalysisSegment[] = []
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const completion = completions[batchIndex]
    const batch = batches[batchIndex]
    if (!completion || !batch) continue
    for (const tile of batch) {
      segments.push({
        imageIndex: tile.imageIndex,
        tileIndex: tile.tileIndex,
        batchIndex,
        bounds: tile.bounds,
        text: completion.text,
      })
    }
  }
  const successful = completions.filter(completion => completion !== undefined)
  const warnings: AnalysisWarning[] = [...failures]
    .sort((a, b) => a - b)
    .map(batchIndex => ({ code: 'DETAIL_BATCH_FAILED', message: `Detail batch ${String(batchIndex)} failed` }))
  return {
    segments,
    warnings,
    complete: failures.size === 0,
    usage: sumUsage(successful),
    apiCalls: batches.length,
  }
}
