import { toSafeError } from '../../errors.js'
import type { AnalyzeImagesInput, AnalyzeImagesResult } from './schema.js'
import { analyzeImagesInputSchema, analyzeImagesOutputSchema } from './schema.js'

export interface ToolResponse {
  content: { type: 'text'; text: string }[]
  structuredContent?: AnalyzeImagesResult
  isError: boolean
}

export type AnalyzeImagesHandler = (input: unknown) => Promise<ToolResponse>

export interface AnalyzeImagesHandlerDependencies {
  runAnalysis: (input: AnalyzeImagesInput) => Promise<AnalyzeImagesResult>
}

export function createAnalyzeImagesHandler(dependencies: AnalyzeImagesHandlerDependencies): AnalyzeImagesHandler {
  return async input => {
    try {
      const parsedInput = analyzeImagesInputSchema.parse(input)
      const result = analyzeImagesOutputSchema.parse(await dependencies.runAnalysis(parsedInput))
      return {
        content: [{ type: 'text', text: result.answer }],
        structuredContent: result,
        isError: !result.complete && result.answer.length === 0,
      }
    } catch (error) {
      const safe = toSafeError(error)
      return { content: [{ type: 'text', text: safe.safeMessage }], isError: true }
    }
  }
}
