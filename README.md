# openai-vision-mcp-server

[简体中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/openai-vision-mcp-server.svg)](https://www.npmjs.com/package/openai-vision-mcp-server)
[![M8ven Score](https://m8ven.ai/badge/mcp/ygq-future-openai-vision-mcp-server-1hv1os)](https://m8ven.ai/mcp/ygq-future-openai-vision-mcp-server-1hv1os)
[![GitHub Repository](https://img.shields.io/badge/GitHub-ygq--future%2Fopenai--vision--mcp--server-blue?logo=github)](https://github.com/ygq-future/openai-vision-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20.19.0-brightgreen.svg)](https://nodejs.org)

**GitHub Repository**: [https://github.com/ygq-future/openai-vision-mcp-server](https://github.com/ygq-future/openai-vision-mcp-server)

A Model Context Protocol (MCP) stdio server for bounded, high-precision image analysis using OpenAI Chat Completions-compatible Vision APIs (e.g. OpenAI `gpt-4o`, Qwen VL, DeepSeek Vision, Local vLLM/Ollama, etc.).

---

## ✨ Features

- **Multi-Source Image Inputs**: Analyze images directly from `file://` local paths, `http://` / `https://` URLs, or `base64` raw data payloads.
- **Smart Adaptive Tiling & Overview Pipeline**: Automatically generates overview thumbnails and ordered overlapping detail tiles for high-resolution images, preserving visual detail without hitting token limits.
- **Universal OpenAI Compatibility**: Works with any API endpoint following the standard OpenAI `/chat/completions` vision protocol.
- **Configurable Security & Resource Bounds**:
  - Optional SSRF protection for public-network-only deployments (`VISION_ALLOW_PRIVATE_NETWORK=false`).
  - Optional local file root restrictions (`VISION_ALLOWED_FILE_ROOTS`).
  - Configurable ceilings for file size, decoded pixel count, HTTP timeouts, and max redirects.
- **Clean Stdio Transport**: Keeps `stdout` strictly isolated for standard MCP JSON-RPC protocol messages while outputting diagnostics to `stderr` without leaking credentials or payloads.

> [!IMPORTANT]
> Local-file and private-network access are permissive by default for local MCP convenience. Set
> `VISION_ALLOWED_FILE_ROOTS` to explicit roots and `VISION_ALLOW_PRIVATE_NETWORK` to `false` when the MCP client or
> analyzed prompts are not fully trusted.

---

## 🚀 Quick Start

You can run `openai-vision-mcp-server` without manual installation using `npx` or `bunx`.
The executable also resolves correctly when npm launches the current checkout through a `.bin` directory link, so an
explicit version such as `@latest` is optional.

### MCP Client Integration Examples

Add the server to your preferred MCP client's configuration file (e.g., **Claude Desktop**, **Cursor**, **Windsurf**, **VS Code / Antigravity**):

#### Standard `claude_desktop_config.json` / `mcp.json`:

```json
{
  "mcpServers": {
    "vision": {
      "command": "npx",
      "args": ["-y", "openai-vision-mcp-server"],
      "env": {
        "VISION_BASE_URL": "https://api.openai.com/v1",
        "VISION_API_KEY": "your-api-key-here",
        "VISION_MODEL": "gpt-4o"
      }
    }
  }
}
```

---

## ⚙️ Environment Variables & Configuration

Configuration is passed entirely through environment variables defined in the MCP server configuration:

| Environment Variable           | Type    | Required | Default    | Description                                                                               |
| :----------------------------- | :------ | :------- | :--------- | :---------------------------------------------------------------------------------------- |
| `VISION_BASE_URL`              | String  | **Yes**  | —          | Base URL of the OpenAI-compatible API (e.g., `https://api.openai.com/v1`).                |
| `VISION_API_KEY`               | String  | **Yes**  | —          | API key for authentication.                                                               |
| `VISION_MODEL`                 | String  | **Yes**  | —          | Vision model name exposed by the configured OpenAI-compatible endpoint (e.g., `gpt-4o` or `qwen-vl-max`). |
| `VISION_DEFAULT_MAX_TILES`     | Integer | No       | `24`       | Default hard ceiling for detail tiles (1 to 64).                                          |
| `VISION_ALLOWED_FILE_ROOTS`    | String  | No       | `""`       | Optional delimiter-separated path whitelist for `file://` URIs. When unset, all local regular files are accessible by default. |
| `VISION_ALLOW_PRIVATE_NETWORK` | Boolean | No       | `true`     | Set to `false` to block `http(s)://` fetches targeting private/internal IPs.               |
| `VISION_MAX_INPUT_BYTES`       | Integer | No       | `20971520` | Max raw image download size in bytes (default: 20MB).                                     |
| `VISION_MAX_DECODED_PIXELS`    | Integer | No       | `100000000`| Max allowed total decoded image pixels (default: 100MP).                                  |
| `VISION_HTTP_TIMEOUT_MS`       | Integer | No       | `30000`    | HTTP request timeout in milliseconds (30s).                                               |
| `VISION_MAX_REDIRECTS`         | Integer | No       | `3`        | Maximum HTTP redirect count.                                                              |
| `VISION_MAX_CONCURRENCY`       | Integer | No       | `1`        | Max concurrent tile processing calls (default 1 to prevent 429 rate limits).              |

---

## 🛠 Available Tools

### `analyze_images`

Analyzes single or multiple images using configured Vision models and produces structured analysis reports.
The MCP declaration marks the Tool as read-only and non-destructive, non-idempotent because each call can consume
upstream API usage, and open-world because it can fetch remote images and call an external Vision endpoint.

#### Input Schema

| Property   | Type                            | Description                                                     |
| :--------- | :------------------------------ | :-------------------------------------------------------------- |
| `prompt`   | `string`                        | The query or instruction for the vision analysis.               |
| `images`   | `Array<ImageSource>`            | List of image objects to analyze (1 to 10).                     |
| `coverage` | `"auto" \| "overview" \| "full"` | Tiling strategy (`auto` by default).                            |
| `maxTiles` | `integer` (optional)            | Override hard ceiling for detail tiles for this call (1 to 64). |

##### ImageSource Types

- **File Source**: `{ "type": "file", "uri": "file:///path/to/image.png", "label": "optional label" }`
- **URL Source**: `{ "type": "url", "url": "https://example.com/photo.jpg", "label": "optional label" }`
- **Base64 Source**: `{ "type": "base64", "data": "<base64_string>", "mediaType": "image/png", "label": "optional label" }`

#### Results, warnings, and errors

A successful result includes `complete`. When `complete` is `false`, the answer may still contain useful evidence, but
every `warnings[]` entry explains the missing coverage with these machine-readable fields:

```json
{
  "code": "TILE_BUDGET_EXCEEDED",
  "message": "Detail coverage requires 16 tiles, but this call allows 10.",
  "retryable": false,
  "userActionRequired": true,
  "nextAction": "Continue with the partial result, disclose the missing coverage, and increase maxTiles only if the user requests complete analysis.",
  "details": { "requiredTiles": 16, "allowedTiles": 10 }
}
```

A failed Tool call returns `isError: true`, the same guidance as readable text, and
`structuredContent.error` containing `code`, `message`, `retryable`, `userActionRequired`, `nextAction`, and optional
safe `details`. The calling AI should follow `nextAction`: permanent input/configuration/protocol failures explicitly
say not to retry, while transient network, timeout, rate-limit, and server failures allow one bounded caller retry. If
the same transient failure repeats, stop and notify the user instead of looping.

Errors never include credentials, authorization headers, Base64/image bytes, upstream response bodies, complete local
paths or URLs, stack traces, or full prompts.

---

## 💻 Local Development

This project uses **Bun** for fast testing and compilation.

```bash
# Install dependencies
bun install

# Run unit and integration tests
bun test

# Run code check (format, lint, typecheck, test, build)
bun run check

# Build output files
bun run build
```

---

## 📄 License

[MIT License](LICENSE) © 2026 [ygq-future](https://github.com/ygq-future)
