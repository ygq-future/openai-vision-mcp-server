export function buildOverviewPrompt(userPrompt: string, imageIndex: number): string {
  return `Analyze overview image index ${String(imageIndex)} for this user request: ${JSON.stringify(userPrompt)}.

Return exactly one JSON object with these fields:
- overview: a concise answer based only on what is visibly supported
- overviewSufficient: whether this overview alone is sufficient to answer reliably
- contentKinds: observed values from document, screenshot, diagram, photo, uncertain
- regions: important detail regions as {x,y,width,height}, each coordinate normalized between 0 and 1
- uncertainties: anything unreadable, ambiguous, cropped, or requiring detail inspection

Do not invent semantic crop boundaries or claim small text is legible when it is not. Preserve the user's requested task in the overview answer.`
}
