import type { VisionClient } from '../openai/client.js'
import type { AnalysisSegment, AnalysisWarning } from '../tools/analyze-images/schema.js'
import type { TokenUsage } from './analyzer.js'

export interface AggregationInput {
  userPrompt: string
  overviewText: string
  segments: readonly AnalysisSegment[]
  warnings: readonly AnalysisWarning[]
  complete: boolean
  usage: TokenUsage
  client: VisionClient
}

export interface AggregationResult {
  answer: string
  segments: AnalysisSegment[]
  warnings: AnalysisWarning[]
  complete: boolean
  usage: TokenUsage
  apiCalls: number
}

function orderedSegments(segments: readonly AnalysisSegment[]): AnalysisSegment[] {
  return [...segments].sort(
    (a, b) => a.batchIndex - b.batchIndex || (a.tileIndex ?? -1) - (b.tileIndex ?? -1) || a.imageIndex - b.imageIndex,
  )
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  const add = (field: keyof TokenUsage): number | null =>
    left[field] === null || right[field] === null ? null : left[field] + right[field]
  return {
    promptTokens: add('promptTokens'),
    completionTokens: add('completionTokens'),
    totalTokens: add('totalTokens'),
  }
}

function aggregationPrompt(input: AggregationInput, segments: readonly AnalysisSegment[]): string {
  const observations = segments
    .map(
      segment =>
        `[image ${String(segment.imageIndex)}, batch ${String(segment.batchIndex)}, tile ${String(segment.tileIndex)}, bounds ${JSON.stringify(segment.bounds)}]\n${segment.text}`,
    )
    .join('\n\n')
  return `Answer the user's request: ${JSON.stringify(input.userPrompt)}
Overview: ${input.overviewText}
Known warnings or missing regions: ${JSON.stringify(input.warnings)}
Ordered detail observations:
${observations}

Merge the evidence, remove overlap duplicates, preserve spatial relationships, expose contradictions, and do not claim analysis of missing regions. Return only the final answer.`
}

export async function aggregateAnalysis(input: AggregationInput): Promise<AggregationResult> {
  const segments = orderedSegments(input.segments)
  try {
    const completion = await input.client.complete({ prompt: aggregationPrompt(input, segments), images: [] })
    return {
      answer: completion.text,
      segments,
      warnings: [...input.warnings],
      complete: input.complete,
      usage: addUsage(input.usage, completion.usage),
      apiCalls: 1,
    }
  } catch {
    const fallback = [
      input.overviewText ? `[overview]\n${input.overviewText}` : '',
      ...segments.map(
        segment =>
          `[image ${String(segment.imageIndex)}, batch ${String(segment.batchIndex)}, tile ${String(segment.tileIndex)}]\n${segment.text}`,
      ),
    ]
      .filter(Boolean)
      .join('\n\n')
    return {
      answer: fallback,
      segments,
      warnings: [
        ...input.warnings,
        { code: 'AGGREGATION_FAILED', message: 'Final aggregation failed; ordered observations are returned' },
      ],
      complete: false,
      usage: input.usage,
      apiCalls: 1,
    }
  }
}
