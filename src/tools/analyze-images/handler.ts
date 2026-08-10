import type { CallToolResult } from '@modelcontextprotocol/server'
import { formatActionableIssue, toSafeError, VisionError } from '../../errors.js'
import type { AnalyzeImagesInput, AnalyzeImagesResult } from './schema.js'
import { analyzeImagesInputSchema, analyzeImagesOutputSchema } from './schema.js'

export type ToolResponse = CallToolResult

export type AnalyzeImagesHandler = (input: unknown) => Promise<ToolResponse>

export interface AnalyzeImagesHandlerDependencies {
  runAnalysis: (input: AnalyzeImagesInput) => Promise<AnalyzeImagesResult>
}

export function createAnalyzeImagesHandler(dependencies: AnalyzeImagesHandlerDependencies): AnalyzeImagesHandler {
  return async input => {
    try {
      const parsedInput = analyzeImagesInputSchema.safeParse(input)
      if (!parsedInput.success) {
        const fields = [...new Set(parsedInput.error.issues.map(issue => String(issue.path[0] ?? 'input')))].sort()
        throw new VisionError('INPUT_INVALID', `The analyze_images arguments are invalid: ${fields.join(', ')}.`, {
          details: { invalidFields: fields.join(', ') },
        })
      }
      const result = analyzeImagesOutputSchema.parse(await dependencies.runAnalysis(parsedInput.data))
      return {
        content: [{ type: 'text', text: result.answer }],
        structuredContent: { ...result },
        isError: !result.complete && result.answer.length === 0,
      }
    } catch (error) {
      const safe = toSafeError(error)
      const issue = safe.toIssue()
      return {
        content: [{ type: 'text', text: formatActionableIssue(issue) }],
        structuredContent: { error: issue },
        isError: true,
      }
    }
  }
}
