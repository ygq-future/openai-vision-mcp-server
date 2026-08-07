import { describe, expect, test } from 'bun:test'
import { buildOverviewPrompt } from '../../src/openai/prompts.js'
import { needsDetail, parseOverviewPlan } from '../../src/pipeline/planner.js'

const validPlan = {
  overview: 'A dense diagram',
  overviewSufficient: false,
  contentKinds: ['diagram'],
  regions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
  uncertainties: ['Small labels may be unreadable'],
}

describe('overview planning', () => {
  test.each([
    JSON.stringify(validPlan),
    `\`\`\`json\n${JSON.stringify(validPlan)}\n\`\`\``,
    `Planning result follows: ${JSON.stringify(validPlan)} end`,
  ])('parses the first balanced JSON object', text => {
    expect(parseOverviewPlan(text)).toMatchObject({ ...validPlan, parseStatus: 'parsed' })
  })

  test('handles braces and escapes inside JSON strings', () => {
    const text = JSON.stringify({ ...validPlan, overview: 'A label says "{ok}" and \\ path' })
    expect(parseOverviewPlan(`prefix ${text} suffix`).overview).toBe('A label says "{ok}" and \\ path')
  })

  test.each([
    'not JSON',
    '{"overview":"broken"',
    JSON.stringify({ ...validPlan, regions: [{ x: 1.1, y: 0, width: 1, height: 1 }] }),
  ])('falls back safely for malformed or invalid output', text => {
    expect(parseOverviewPlan(text)).toEqual({
      overview: text,
      overviewSufficient: false,
      contentKinds: ['uncertain'],
      regions: [],
      uncertainties: ['Overview planning output was not machine-readable'],
      parseStatus: 'uncertain',
    })
  })

  test('routes coverage without claiming uncertain overviews are sufficient', () => {
    const parsed = parseOverviewPlan(JSON.stringify(validPlan))
    expect(needsDetail('overview', parsed)).toBe(false)
    expect(needsDetail('full', { ...parsed, overviewSufficient: true, regions: [], uncertainties: [] })).toBe(true)
    expect(needsDetail('auto', { ...parsed, overviewSufficient: true, regions: [], uncertainties: [] })).toBe(false)
    expect(needsDetail('auto', parsed)).toBe(true)
    expect(needsDetail('auto', parseOverviewPlan('bad'))).toBe(true)
  })

  test('builds a prompt that requires normalized evidence and preserves the user request', () => {
    const prompt = buildOverviewPrompt('Read every label', 2)
    expect(prompt).toContain('Read every label')
    expect(prompt).toContain('image index 2')
    expect(prompt).toContain('0 and 1')
    expect(prompt).toContain('uncertainties')
  })
})
