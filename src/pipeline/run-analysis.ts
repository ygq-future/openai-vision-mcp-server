import type { VisionConfig } from '../config.js'
import { IMAGE_POLICY } from '../constants.js'
import { toSafeError, VisionError } from '../errors.js'
import { acquireImage } from '../image/acquire.js'
import { normalizeImage } from '../image/normalize.js'
import { createOverview } from '../image/overview.js'
import { createGrid, encodeTile, expandRegion, selectEvenlyDistributed } from '../image/tiles.js'
import type { ContentKind, TileBounds } from '../image/tiles.js'
import type { AcquiredImage, AcquisitionContext, EncodedImage, NormalizedImage } from '../image/types.js'
import type { VisionClient, VisionCompletion } from '../openai/client.js'
import { buildOverviewPrompt } from '../openai/prompts.js'
import type {
  AnalysisWarning,
  AnalyzeImagesInput,
  AnalyzeImagesResult,
  ImageSource,
} from '../tools/analyze-images/schema.js'
import { analyzeImagesOutputSchema } from '../tools/analyze-images/schema.js'
import { aggregateAnalysis } from './aggregator.js'
import { analyzeDetailTiles } from './analyzer.js'
import type { DetailTile, TokenUsage } from './analyzer.js'
import { needsDetail, parseOverviewPlan } from './planner.js'
import type { OverviewPlan } from './planner.js'

export interface AnalysisContext {
  config: VisionConfig
  client: VisionClient
  acquire?: (source: ImageSource, context: AcquisitionContext) => Promise<AcquiredImage>
  normalize?: (image: AcquiredImage, maxDecodedPixels: number) => Promise<NormalizedImage>
  createOverview?: (image: NormalizedImage) => Promise<EncodedImage>
  encodeTile?: (image: NormalizedImage, bounds: TileBounds, contentKind: ContentKind) => Promise<EncodedImage>
}

interface PreparedImage {
  imageIndex: number
  image: NormalizedImage
  plan: OverviewPlan
  grid: TileBounds[]
}

interface CandidateTile {
  imageIndex: number
  image: NormalizedImage
  tileIndex: number
  bounds: TileBounds
  contentKind: ContentKind
  preferred: boolean
}

function intersects(a: TileBounds, b: TileBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function chooseCandidates(candidates: readonly CandidateTile[], cap: number): CandidateTile[] {
  if (candidates.length <= cap) return [...candidates]
  const preferred = candidates.filter(candidate => candidate.preferred).slice(0, cap)
  const selectedKeys = new Set(
    preferred.map(candidate => `${String(candidate.imageIndex)}:${String(candidate.tileIndex)}`),
  )
  const remaining = candidates.filter(
    candidate => !selectedKeys.has(`${String(candidate.imageIndex)}:${String(candidate.tileIndex)}`),
  )
  const slots = Math.min(cap - preferred.length, remaining.length)
  preferred.push(...selectEvenlyDistributed(remaining, slots))
  return preferred.sort((a, b) => a.imageIndex - b.imageIndex || a.tileIndex - b.tileIndex)
}

function combineUsage(completions: readonly VisionCompletion[]): TokenUsage {
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

function combineTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  const add = (field: keyof TokenUsage): number | null =>
    left[field] === null || right[field] === null ? null : left[field] + right[field]
  return {
    promptTokens: add('promptTokens'),
    completionTokens: add('completionTokens'),
    totalTokens: add('totalTokens'),
  }
}

export async function runAnalysis(input: AnalyzeImagesInput, context: AnalysisContext): Promise<AnalyzeImagesResult> {
  const acquire = context.acquire ?? acquireImage
  const normalize = context.normalize ?? normalizeImage
  const overviewEncoder = context.createOverview ?? createOverview
  const tileEncoder = context.encodeTile ?? encodeTile
  const acquisitionContext: AcquisitionContext = {
    maxInputBytes: context.config.maxInputBytes,
    allowedFileRoots: context.config.allowedFileRoots,
    allowPrivateNetwork: context.config.allowPrivateNetwork,
    httpTimeoutMs: context.config.httpTimeoutMs,
    maxRedirects: context.config.maxRedirects,
  }
  const warnings: AnalysisWarning[] = []
  const prepared: PreparedImage[] = []
  const overviewSegments: AnalyzeImagesResult['segments'] = []
  const overviewCompletions: VisionCompletion[] = []
  let overviewCalls = 0
  let lastFailure: VisionError | undefined

  const overviewImages: EncodedImage[] = []
  for (let imageIndex = 0; imageIndex < input.images.length; imageIndex += 1) {
    const source = input.images[imageIndex]
    if (!source) continue
    try {
      const acquired = await acquire(source, acquisitionContext)
      const image = await normalize(acquired, context.config.maxDecodedPixels)
      const overview = await overviewEncoder(image)
      overviewImages.push(overview)
      overviewCalls += 1
      const completion = await context.client.complete({
        prompt: buildOverviewPrompt(input.prompt, imageIndex),
        images: [overview],
      })
      overviewCompletions.push(completion)
      const plan = parseOverviewPlan(completion.text)
      overviewSegments.push({ imageIndex, tileIndex: null, batchIndex: 0, bounds: null, text: plan.overview })
      prepared.push({
        imageIndex,
        image,
        plan,
        grid: needsDetail(input.coverage, plan)
          ? createGrid(image.width, image.height, IMAGE_POLICY.grid.tileSize, IMAGE_POLICY.grid.overlap)
          : [],
      })
    } catch (error) {
      lastFailure = toSafeError(error)
      warnings.push({
        code: 'IMAGE_FAILED',
        message: `Image ${String(imageIndex)} was skipped: ${lastFailure.safeMessage}`,
        retryable: lastFailure.retryable,
        userActionRequired: true,
        nextAction: lastFailure.retryable
          ? 'Continue with the other images and disclose this omission. Retry this image once only if it is required.'
          : `Continue with the other images and disclose this omission. ${lastFailure.nextAction}`,
        details: { ...lastFailure.details, underlyingCode: lastFailure.code, imageIndex },
        imageIndex,
      })
    }
  }
  if (prepared.length === 0) {
    throw lastFailure ?? new VisionError('DECODE_FAILED', 'No supplied image could be analyzed.')
  }

  const candidates: CandidateTile[] = prepared.flatMap(item => {
    const preferredRegions = item.plan.regions.map(region =>
      expandRegion(region, item.image.width, item.image.height, IMAGE_POLICY.grid.preferredRegionMargin),
    )
    return item.grid.map((bounds, tileIndex) => ({
      imageIndex: item.imageIndex,
      image: item.image,
      tileIndex,
      bounds,
      contentKind: item.plan.contentKinds[0] ?? 'uncertain',
      preferred: preferredRegions.some(region => intersects(bounds, region)),
    }))
  })
  const maxTiles = input.maxTiles ?? context.config.defaultMaxTiles
  const selected = chooseCandidates(candidates, maxTiles)
  if (selected.length < candidates.length) {
    warnings.push({
      code: 'TILE_BUDGET_EXCEEDED',
      message: `Detail coverage requires ${String(candidates.length)} tiles, but this call allows ${String(maxTiles)}.`,
      retryable: false,
      userActionRequired: true,
      nextAction:
        'Continue with the partial result, disclose the missing coverage, and increase maxTiles only if the user requests complete analysis.',
      details: { requiredTiles: candidates.length, allowedTiles: maxTiles },
    })
  }

  const detailTiles: DetailTile[] = []
  for (const candidate of selected) {
    try {
      detailTiles.push({
        imageIndex: candidate.imageIndex,
        tileIndex: candidate.tileIndex,
        bounds: candidate.bounds,
        encoded: await tileEncoder(candidate.image, candidate.bounds, candidate.contentKind),
      })
    } catch (error) {
      const safe = toSafeError(error)
      warnings.push({
        code: 'DETAIL_TILE_FAILED',
        message: `Detail tile ${String(candidate.tileIndex)} for image ${String(candidate.imageIndex)} was skipped: ${safe.safeMessage}`,
        retryable: safe.retryable,
        userActionRequired: true,
        nextAction:
          'Continue with the available regions and disclose this missing tile. Do not retry the entire analysis automatically.',
        details: {
          ...safe.details,
          underlyingCode: safe.code,
          imageIndex: candidate.imageIndex,
          tileIndex: candidate.tileIndex,
        },
        imageIndex: candidate.imageIndex,
      })
    }
  }

  const overviewUsage = combineUsage(overviewCompletions)
  if (detailTiles.length === 0) {
    const result: AnalyzeImagesResult = {
      answer: overviewSegments.map(segment => segment.text).join('\n\n'),
      complete: warnings.length === 0,
      model: context.config.model,
      sourceCount: prepared.length,
      overviewCalls,
      detailTiles: 0,
      apiCalls: overviewCalls,
      segments: overviewSegments,
      usage: overviewUsage,
      warnings,
    }
    return analyzeImagesOutputSchema.parse(result)
  }

  const detail = await analyzeDetailTiles({
    tiles: detailTiles,
    userPrompt: input.prompt,
    client: context.client,
    maxConcurrency: context.config.maxConcurrency,
  })
  warnings.push(...detail.warnings)
  const usageBeforeAggregation = combineTokenUsage(overviewUsage, detail.usage)
  const aggregation = await aggregateAnalysis({
    userPrompt: input.prompt,
    overviewText: overviewSegments.map(segment => segment.text).join('\n\n'),
    overviewImages,
    segments: [...overviewSegments, ...detail.segments],
    warnings,
    complete: warnings.length === 0 && detail.complete,
    usage: usageBeforeAggregation,
    client: context.client,
  })
  return analyzeImagesOutputSchema.parse({
    ...aggregation,
    model: context.config.model,
    sourceCount: prepared.length,
    overviewCalls,
    detailTiles: detailTiles.length,
    apiCalls: overviewCalls + detail.apiCalls + aggregation.apiCalls,
  })
}
