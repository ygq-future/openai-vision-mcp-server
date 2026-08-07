import { z } from 'zod'

const textPartSchema = z.looseObject({ type: z.literal('text'), text: z.string() })

export const chatCompletionResponseSchema = z
  .object({
    choices: z
      .array(
        z.object({
          message: z.looseObject({ content: z.union([z.string(), z.array(textPartSchema)]) }),
          finish_reason: z.string().nullable().optional(),
        }),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        total_tokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
  })
  .loose()

export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>
