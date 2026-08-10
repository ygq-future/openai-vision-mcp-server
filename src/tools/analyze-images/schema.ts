import { z } from 'zod'
import { TOOL_LIMITS } from '../../constants.js'

export const maxTilesDescription =
  'Hard ceiling for detail tiles in this call; overview images do not count. If the user states a maximum number of tiles, slices, crops, regions, or 切片, pass that exact integer. Omit when the user gives no limit.'

const labelSchema = z.string().trim().min(TOOL_LIMITS.labelLength.min).max(TOOL_LIMITS.labelLength.max).optional()

const fileSourceSchema = z
  .object({
    type: z.literal('file'),
    uri: z.url().startsWith('file://'),
    label: labelSchema,
  })
  .strict()

const urlSourceSchema = z
  .object({
    type: z.literal('url'),
    url: z.url().refine(value => URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol), {
      message: 'URL source must use HTTP or HTTPS',
    }),
    label: labelSchema,
  })
  .strict()

const base64SourceSchema = z
  .object({
    type: z.literal('base64'),
    data: z.string().min(1),
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']).optional(),
    label: labelSchema,
  })
  .strict()

export const imageSourceSchema = z.discriminatedUnion('type', [fileSourceSchema, urlSourceSchema, base64SourceSchema])

export const analyzeImagesInputSchema = z
  .object({
    prompt: z.string().trim().min(TOOL_LIMITS.promptLength.min).max(TOOL_LIMITS.promptLength.max),
    images: z.array(imageSourceSchema).min(TOOL_LIMITS.imagesPerCall.min).max(TOOL_LIMITS.imagesPerCall.max),
    coverage: z.enum(['auto', 'overview', 'full']).default('auto'),
    maxTiles: z
      .number()
      .int()
      .min(TOOL_LIMITS.detailTiles.min)
      .max(TOOL_LIMITS.detailTiles.max)
      .optional()
      .describe(maxTilesDescription),
  })
  .strict()

const boundsSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict()

const segmentSchema = z
  .object({
    imageIndex: z.number().int().nonnegative(),
    tileIndex: z.number().int().nonnegative().nullable(),
    batchIndex: z.number().int().nonnegative(),
    bounds: boundsSchema.nullable(),
    text: z.string(),
  })
  .strict()

const nullableTokenCountSchema = z.number().int().nonnegative().nullable()
const safeDetailValueSchema = z.union([z.string(), z.number(), z.boolean()])

const usageSchema = z
  .object({
    promptTokens: nullableTokenCountSchema,
    completionTokens: nullableTokenCountSchema,
    totalTokens: nullableTokenCountSchema,
  })
  .strict()

const warningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    userActionRequired: z.boolean(),
    nextAction: z.string().min(1),
    details: z.record(z.string(), safeDetailValueSchema).optional(),
    imageIndex: z.number().int().nonnegative().optional(),
  })
  .strict()

export const analyzeImagesOutputSchema = z
  .object({
    answer: z.string(),
    complete: z.boolean(),
    model: z.string().min(1),
    sourceCount: z.number().int().nonnegative(),
    overviewCalls: z.number().int().nonnegative(),
    detailTiles: z.number().int().nonnegative(),
    apiCalls: z.number().int().nonnegative(),
    segments: z.array(segmentSchema),
    usage: usageSchema,
    warnings: z.array(warningSchema),
  })
  .strict()

export type ImageSource = z.infer<typeof imageSourceSchema>
export type AnalyzeImagesInput = z.infer<typeof analyzeImagesInputSchema>
export type AnalyzeImagesResult = z.infer<typeof analyzeImagesOutputSchema>
export type AnalysisSegment = z.infer<typeof segmentSchema>
export type AnalysisWarning = z.infer<typeof warningSchema>
