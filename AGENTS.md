# Repository Instructions

## Project purpose

Build `openai-vision-mcp-server`, a local stdio MCP server that accepts images from `file://` URIs, HTTP(S) URLs, or Base64, preprocesses them, and analyzes them through an OpenAI Chat Completions-compatible vision endpoint.

## Fixed product decisions

- Support only the OpenAI Chat Completions-compatible request and response format.
- Do not add Anthropic support, provider switching, a provider interface, or a generic adapter layer.
- Run as a local stdio MCP server and publish an executable npm package for `npx` usage.
- Read provider configuration only from the MCP client's per-server environment variables.
- Keep stdout exclusively for MCP JSON-RPC messages. Send diagnostics to stderr and never log credentials or Base64 payloads.
- Store project documentation and plans under `docs/`. This directory is intentionally ignored by Git.

## Runtime and package management

- Use TypeScript with strict type checking and ESM output.
- Support Node.js 20.19.0 or newer.
- Use Bun for dependency installation, scripts, tests, packing, and publishing.
- Commit `bun.lock`; do not generate npm, pnpm, or Yarn lockfiles.
- Prefer Node.js built-ins and native `fetch`. Do not add the OpenAI SDK unless a future requirement cannot be met by the fixed Chat Completions HTTP contract.

## Required formatting

Prettier must use exactly:

```json
{
  "singleQuote": true,
  "semi": false,
  "trailingComma": "all",
  "printWidth": 120,
  "tabWidth": 2,
  "arrowParens": "avoid",
  "endOfLine": "lf",
  "bracketSpacing": true,
  "bracketSameLine": true
}
```

Use ESLint flat configuration with type-aware TypeScript rules. Do not disable a rule inline unless the comment explains the concrete reason.

## Architecture constraints

- Keep image acquisition, validation, normalization, tiling, API calls, aggregation, and MCP transport in separate focused modules.
- Decode each source once. Generate the overview and detail tiles from the decoded original, never from an already compressed derivative.
- Do not claim to know semantic content before the first vision call. Overview planning may propose regions; uncertain results must fall back to deterministic overlapping grid coverage.
- Treat `maxTiles` as a hard per-call ceiling on detail tiles. The overview does not count toward it.
- Preserve tile and batch order explicitly. Never rely on promise completion order.
- When a budget prevents complete coverage, return `complete: false` with a machine-readable warning; never silently imply complete analysis.
- Protect local-file reads with allowed roots and remote fetches with SSRF checks, redirect limits, timeouts, byte limits, and decoded-pixel limits.

## Development workflow

- Follow test-driven development: add a failing test, verify the failure, implement the smallest behavior, then rerun focused and full checks.
- Run `bun run check` before every commit.
- Add unit tests for pure policy and transformation logic, integration tests for HTTP/image pipelines, and an MCP stdio smoke test.
- Use conventional commit messages with focused scope.
- Do not publish from an unclean working tree.
