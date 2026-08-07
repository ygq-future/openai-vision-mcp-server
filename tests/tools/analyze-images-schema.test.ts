import { describe, expect, test } from 'bun:test'
import {
  analyzeImagesInputSchema,
  analyzeImagesOutputSchema,
  maxTilesDescription,
} from '../../src/tools/analyze-images/schema.js'
import type { AnalyzeImagesResult } from '../../src/tools/analyze-images/schema.js'

describe('analyze_images input', () => {
  test('accepts all source types and an explicit tile ceiling', () => {
    const value = analyzeImagesInputSchema.parse({
      prompt: 'Read every visible label',
      images: [
        { type: 'file', uri: 'file:///D:/images/page.png' },
        { type: 'url', url: 'https://example.com/a.png', label: 'remote' },
        { type: 'base64', data: 'aGVsbG8=', mediaType: 'image/png' },
      ],
      coverage: 'full',
      maxTiles: 10,
    })

    expect(value.maxTiles).toBe(10)
    expect(value.coverage).toBe('full')
  })

  test('defaults coverage to auto and leaves maxTiles unset', () => {
    const value = analyzeImagesInputSchema.parse({
      prompt: 'Describe',
      images: [{ type: 'url', url: 'https://example.com/a.png' }],
    })

    expect(value.coverage).toBe('auto')
    expect(value.maxTiles).toBeUndefined()
  })

  test.each([0, 65, 1.5])('rejects invalid tile ceiling %s', maxTiles => {
    expect(() =>
      analyzeImagesInputSchema.parse({
        prompt: 'Describe',
        images: [{ type: 'url', url: 'https://example.com/a.png' }],
        maxTiles,
      }),
    ).toThrow()
  })

  test('describes the natural-language hard ceiling mapping', () => {
    expect(maxTilesDescription).toContain('Hard ceiling')
    expect(maxTilesDescription).toContain('overview images do not count')
    expect(maxTilesDescription).toContain('切片')
    expect(maxTilesDescription).toContain('exact integer')
  })

  test('rejects empty prompts, unsupported media, and too many images', () => {
    expect(() => analyzeImagesInputSchema.parse({ prompt: '', images: [{ type: 'base64', data: 'AA==' }] })).toThrow()
    expect(() =>
      analyzeImagesInputSchema.parse({
        prompt: 'Describe',
        images: [{ type: 'base64', data: 'AA==', mediaType: 'image/svg+xml' }],
      }),
    ).toThrow()
    expect(() =>
      analyzeImagesInputSchema.parse({
        prompt: 'Describe',
        images: Array.from({ length: 11 }, () => ({ type: 'url', url: 'https://example.com/a.png' })),
      }),
    ).toThrow()
  })
})

describe('analyze_images output', () => {
  const completeResult: AnalyzeImagesResult = {
    answer: 'The image contains a diagram.',
    complete: true,
    model: 'vision-model',
    sourceCount: 1,
    overviewCalls: 1,
    detailTiles: 0,
    apiCalls: 1,
    segments: [
      {
        imageIndex: 0,
        tileIndex: null,
        batchIndex: 0,
        bounds: null,
        text: 'Overview result',
      },
    ],
    usage: { promptTokens: null, completionTokens: null, totalTokens: null },
    warnings: [],
  }

  test('accepts a complete result with nullable overview fields and usage', () => {
    expect(analyzeImagesOutputSchema.parse(completeResult)).toEqual(completeResult)
  })

  test('accepts valid tile bounds and warning image indexes', () => {
    const result = structuredClone(completeResult)
    result.segments[0] = {
      imageIndex: 0,
      tileIndex: 2,
      batchIndex: 1,
      bounds: { x: 10, y: 20, width: 1024, height: 900 },
      text: 'Tile result',
    }
    const withWarning = {
      ...result,
      complete: false,
      warnings: [{ code: 'TILE_BUDGET_EXCEEDED', message: 'Partial', imageIndex: 0 }],
    }

    expect(analyzeImagesOutputSchema.parse(withWarning).complete).toBe(false)
  })

  test('rejects missing completeness and invalid bounds', () => {
    expect(() => analyzeImagesOutputSchema.parse({ ...completeResult, complete: undefined })).toThrow()
    expect(() =>
      analyzeImagesOutputSchema.parse({
        ...completeResult,
        segments: [{ ...completeResult.segments[0], bounds: { x: -1, y: 0, width: 0, height: 10 } }],
      }),
    ).toThrow()
  })
})
