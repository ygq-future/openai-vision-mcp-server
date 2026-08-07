import { McpServer } from '@modelcontextprotocol/server'
import type { VisionConfig } from './config.js'
import { createVisionClient } from './openai/client.js'
import type { VisionClient } from './openai/client.js'
import { runAnalysis } from './pipeline/run-analysis.js'
import { createAnalyzeImagesHandler } from './tools/analyze-images/handler.js'
import { analyzeImagesInputSchema, analyzeImagesOutputSchema } from './tools/analyze-images/schema.js'

export interface ServerDependencies {
  config: VisionConfig
  client?: VisionClient
}

export function createServer(dependencies: ServerDependencies): McpServer {
  const server = new McpServer({ name: 'openai-vision-mcp-server', version: '0.1.4' }, { capabilities: { tools: {} } })
  const client = dependencies.client ?? createVisionClient(dependencies.config)
  const handler = createAnalyzeImagesHandler({
    runAnalysis: input => runAnalysis(input, { config: dependencies.config, client }),
  })
  server.registerTool(
    'analyze_images',
    {
      title: 'Analyze images',
      description:
        'Analyze file://, HTTP(S), or Base64 images through an OpenAI-compatible vision model. The server creates an overview, inspects ordered overlapping detail tiles when needed, and aggregates results without hiding missing coverage. Use maxTiles as the exact hard detail-tile ceiling when the user states a maximum number of tiles, slices, crops, regions, or 切片; overview images do not count.',
      inputSchema: analyzeImagesInputSchema,
      outputSchema: analyzeImagesOutputSchema,
    },
    handler,
  )
  return server
}
