import { z } from 'zod'
import type { ContentKind, NormalizedRegion } from '../image/tiles.js'
import type { AnalyzeImagesInput } from '../tools/analyze-images/schema.js'

const regionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine(region => region.x + region.width <= 1 && region.y + region.height <= 1)

const contentKindSchema = z.enum(['document', 'screenshot', 'diagram', 'photo', 'uncertain'])

const planSchema = z
  .object({
    overview: z.string(),
    overviewSufficient: z.boolean(),
    contentKinds: z.array(contentKindSchema).min(1),
    regions: z.array(regionSchema),
    uncertainties: z.array(z.string()),
  })
  .strict()

export interface OverviewPlan {
  overview: string
  overviewSufficient: boolean
  contentKinds: ContentKind[]
  regions: NormalizedRegion[]
  uncertainties: string[]
  parseStatus: 'parsed' | 'uncertain'
}

function firstBalancedObject(text: string): string | undefined {
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (start < 0) {
      if (character === '{') {
        start = index
        depth = 1
      }
      continue
    }
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return undefined
}

function uncertainPlan(originalText: string): OverviewPlan {
  return {
    overview: originalText,
    overviewSufficient: false,
    contentKinds: ['uncertain'],
    regions: [],
    uncertainties: ['Overview planning output was not machine-readable'],
    parseStatus: 'uncertain',
  }
}

export function parseOverviewPlan(text: string): OverviewPlan {
  const objectText = firstBalancedObject(text)
  if (!objectText) return uncertainPlan(text)
  try {
    const parsed = planSchema.safeParse(JSON.parse(objectText) as unknown)
    if (!parsed.success) return uncertainPlan(text)
    return { ...parsed.data, parseStatus: 'parsed' }
  } catch {
    return uncertainPlan(text)
  }
}

export function needsDetail(coverage: AnalyzeImagesInput['coverage'], plan: OverviewPlan): boolean {
  if (coverage === 'overview') return false
  if (coverage === 'full') return true
  return (
    plan.parseStatus === 'uncertain' ||
    !plan.overviewSufficient ||
    plan.regions.length > 0 ||
    plan.uncertainties.length > 0
  )
}
